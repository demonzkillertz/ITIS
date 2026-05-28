import shutil
from pathlib import Path
from uuid import UUID
from uuid import uuid4

import cv2
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.db.session import get_db
from app.domain.classes import AnnotationTask
from app.domain.schemas import AnnotationSource, AnnotationStatus
from app.domain.schemas import (
    DuplicatePolicy,
    ImportSourceType,
    ImportIssue,
    ImportSessionRead,
    MediaType,
    MediaRead,
    ProcessingJobRead,
    ServerFolderImportCreate,
    ServerFolderImportRead,
)
from app.services.yolo_labels import YoloLabelError, parse_label_file

router = APIRouter()
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}


@router.get("/{dataset_id}/items", response_model=list[MediaRead])
def list_media_items(dataset_id: UUID, db: Session = Depends(get_db)) -> list[MediaRead]:
    ensure_dataset(db, dataset_id)
    items = db.scalars(
        select(models.MediaItem)
        .where(models.MediaItem.dataset_id == dataset_id)
        .order_by(models.MediaItem.created_at.asc())
    ).all()
    return [media_to_read(item) for item in items]


@router.get("/{dataset_id}/import-history", response_model=list[ImportSessionRead])
def list_import_history(dataset_id: UUID, db: Session = Depends(get_db)) -> list[ImportSessionRead]:
    ensure_dataset(db, dataset_id)
    sessions = db.scalars(
        select(models.ImportSession)
        .where(models.ImportSession.dataset_id == dataset_id)
        .order_by(models.ImportSession.created_at.desc())
    ).all()
    return [import_session_to_read(session) for session in sessions]


@router.post("/{dataset_id}/images", response_model=list[MediaRead])
async def upload_images(
    dataset_id: UUID,
    files: list[UploadFile],
    db: Session = Depends(get_db),
) -> list[MediaRead]:
    ensure_dataset(db, dataset_id)
    saved_items: list[models.MediaItem] = []
    upload_root = settings.storage_root / "uploads" / str(dataset_id)
    upload_root.mkdir(parents=True, exist_ok=True)

    for upload in files:
        suffix = "." + upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""
        if suffix not in {".jpg", ".jpeg", ".png"}:
            raise HTTPException(status_code=400, detail=f"Unsupported image type: {upload.filename}")

        storage_name = f"{uuid4()}{suffix}"
        storage_path = upload_root / storage_name
        with storage_path.open("wb") as output:
            shutil.copyfileobj(upload.file, output)

        width, height = read_image_size(storage_path)
        storage_key = f"uploads/{dataset_id}/{storage_name}"
        media_item = models.MediaItem(
            dataset_id=dataset_id,
            file_name=upload.filename,
            storage_key=storage_key,
            media_type=MediaType.IMAGE.value,
            width=width,
            height=height,
        )
        db.add(media_item)
        saved_items.append(media_item)

    db.commit()
    for item in saved_items:
        db.refresh(item)
    return [media_to_read(item) for item in saved_items]


@router.post("/{dataset_id}/server-folder", response_model=ServerFolderImportRead)
def import_server_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderImportRead:
    ensure_dataset(db, dataset_id)
    image_dir, video_dir, label_dir, parent_dir = resolve_import_paths(payload)

    if payload.import_images and (image_dir is None or not image_dir.exists() or not image_dir.is_dir()):
        raise HTTPException(status_code=400, detail="Image folder path does not exist on server")
    if payload.import_videos and (video_dir is None or not video_dir.exists() or not video_dir.is_dir()):
        raise HTTPException(status_code=400, detail="Video folder path does not exist on server")
    if label_dir and (not label_dir.exists() or not label_dir.is_dir()):
        raise HTTPException(status_code=400, detail="Label folder path does not exist on server")

    import_root = settings.storage_root / "uploads" / str(dataset_id)
    frame_root = settings.storage_root / "frames" / str(dataset_id)
    import_root.mkdir(parents=True, exist_ok=True)
    frame_root.mkdir(parents=True, exist_ok=True)
    report = ServerFolderImportRead(
        parent_dir=str(parent_dir) if parent_dir else None,
        image_dir=str(image_dir) if image_dir else None,
        video_dir=str(video_dir) if video_dir else None,
        label_dir=str(label_dir) if label_dir else None,
        source_type=payload.source_type,
        task=payload.task,
        duplicate_policy=payload.duplicate_policy,
    )
    saved_items: list[models.MediaItem] = []
    existing_names = set(
        db.scalars(select(models.MediaItem.file_name).where(models.MediaItem.dataset_id == dataset_id))
    )

    import_session = models.ImportSession(
        dataset_id=dataset_id,
        parent_dir=report.parent_dir,
        image_dir=report.image_dir or "",
        video_dir=report.video_dir,
        label_dir=report.label_dir,
        source_type=payload.source_type,
        task=payload.task,
        duplicate_policy=payload.duplicate_policy,
    )
    db.add(import_session)
    db.flush()

    if payload.import_images and image_dir is not None:
        for image_path in sorted(image_dir.rglob("*")):
            if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            media_item = import_image_file(
                db,
                dataset_id,
                image_path,
                import_root,
                payload,
                report,
                existing_names,
                import_session.id,
            )
            if media_item is None:
                continue
            saved_items.append(media_item)
            if label_dir is not None:
                import_labels_for_media(db, media_item, label_dir / f"{image_path.stem}.txt", payload, report)
            if payload.auto_annotate:
                auto_annotate_image(db, media_item, payload, report)

    if payload.import_videos and video_dir is not None:
        for video_path in sorted(video_dir.rglob("*")):
            if not video_path.is_file() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            video_item = import_video_file(
                db,
                dataset_id,
                video_path,
                import_root,
                payload,
                report,
                existing_names,
                import_session.id,
            )
            if video_item is None:
                continue
            saved_items.append(video_item)
            if payload.extract_video_frames:
                frames = extract_video_frames(
                    db,
                    dataset_id,
                    video_item,
                    video_path,
                    frame_root,
                    payload,
                    report,
                    import_session.id,
                )
                saved_items.extend(frames)
                if payload.auto_annotate:
                    for frame_item in frames:
                        auto_annotate_image(db, frame_item, payload, report)

    import_session.imported_images = report.imported_images
    import_session.imported_videos = report.imported_videos
    import_session.imported_frames = report.imported_frames
    import_session.imported_annotations = report.imported_annotations
    import_session.model_annotations = report.model_annotations
    import_session.skipped_images = report.skipped_images
    import_session.issue_count = len(report.issues)
    db.commit()
    db.refresh(import_session)
    for item in saved_items:
        db.refresh(item)

    report.id = import_session.id
    report.created_at = import_session.created_at
    report.media = [media_to_read(item) for item in saved_items]
    return report


@router.post("/{dataset_id}/videos", response_model=ProcessingJobRead)
async def upload_video(dataset_id: UUID, video: UploadFile) -> ProcessingJobRead:
    _ = (dataset_id, video)
    return ProcessingJobRead(kind="video_processing", message="Video processing queued")


@router.post("/{media_id}/auto-annotate", response_model=ProcessingJobRead)
def auto_annotate_media(
    media_id: UUID,
    task: AnnotationTask = AnnotationTask.VEHICLE,
    db: Session = Depends(get_db),
) -> ProcessingJobRead:
    media = db.get(models.MediaItem, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Media item not found")

    payload = ServerFolderImportCreate(task=task, auto_annotate=True)
    report = ServerFolderImportRead(task=task)
    targets = [media]
    if media.media_type == MediaType.VIDEO.value:
        targets = db.scalars(
            select(models.MediaItem)
            .where(models.MediaItem.parent_media_id == media.id)
            .order_by(models.MediaItem.frame_index.asc())
        ).all()

    for target in targets:
        if target.media_type == MediaType.IMAGE.value:
            auto_annotate_image(db, target, payload, report)

    db.commit()
    return ProcessingJobRead(
        kind="auto_annotation",
        status="completed",
        message=f"Created {report.model_annotations} draft model annotations",
    )


def auto_annotate_image(
    db: Session,
    media_item: models.MediaItem,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
) -> None:
    model_path = settings.vehicle_model_path if payload.task == "vehicle" else settings.plate_model_path
    if not model_path.exists():
        report.issues.append(
            ImportIssue(
                path=str(model_path),
                issue_type="missing_model",
                message=f"No YOLO model file is configured for {payload.task} auto-annotation.",
            )
        )
        return

    try:
        from ultralytics import YOLO

        model = YOLO(str(model_path))
        image_path = settings.storage_root / media_item.storage_key
        results = model.predict(str(image_path), verbose=False)
    except Exception as exc:
        report.issues.append(
            ImportIssue(
                path=media_item.file_name,
                issue_type="model_inference_failed",
                message=str(exc),
            )
        )
        return

    for result in results:
        image_width = float(result.orig_shape[1])
        image_height = float(result.orig_shape[0])
        for box in result.boxes:
            class_id = int(box.cls.item())
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)
            if width <= 0 or height <= 0:
                continue
            db.add(
                models.Annotation(
                    media_id=media_item.id,
                    task=payload.task,
                    class_id=class_id,
                    x_center=(x1 + width / 2) / image_width,
                    y_center=(y1 + height / 2) / image_height,
                    width=width / image_width,
                    height=height / image_height,
                    confidence=float(box.conf.item()),
                    source=AnnotationSource.MODEL,
                    status=AnnotationStatus.DRAFT,
                    is_prefetched=False,
                )
            )
            report.model_annotations += 1


def ensure_dataset(db: Session, dataset_id: UUID) -> models.Dataset:
    dataset = db.get(models.Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


def read_image_size(path) -> tuple[int, int]:
    image = cv2.imread(str(path))
    if image is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a readable image")
    height, width = image.shape[:2]
    return int(width), int(height)


def resolve_import_paths(
    payload: ServerFolderImportCreate,
) -> tuple[Path | None, Path | None, Path | None, Path | None]:
    parent_dir = Path(payload.parent_dir).expanduser() if payload.parent_dir else None
    explicit_image_dir = Path(payload.image_dir).expanduser() if payload.image_dir else None
    explicit_video_dir = Path(payload.video_dir).expanduser() if payload.video_dir else None
    explicit_label_dir = Path(payload.label_dir).expanduser() if payload.label_dir else None

    if payload.mode == "explicit":
        return explicit_image_dir, explicit_video_dir, explicit_label_dir, parent_dir

    if parent_dir is not None:
        images_child = parent_dir / "images"
        videos_child = parent_dir / "videos"
        labels_child = parent_dir / "labels"
        image_dir = images_child if images_child.is_dir() else parent_dir
        video_dir = explicit_video_dir or (videos_child if videos_child.is_dir() else parent_dir)
        label_dir = explicit_label_dir or (labels_child if labels_child.is_dir() else None)
        return image_dir, video_dir, label_dir, parent_dir

    if explicit_image_dir is None and explicit_video_dir is None:
        raise HTTPException(status_code=400, detail="Enter a parent, image, or video folder")
    return explicit_image_dir, explicit_video_dir, explicit_label_dir, None


def import_image_file(
    db: Session,
    dataset_id: UUID,
    image_path: Path,
    import_root: Path,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
    existing_names: set[str],
    import_session_id: UUID,
) -> models.MediaItem | None:
    if payload.duplicate_policy == DuplicatePolicy.SKIP and image_path.name in existing_names:
        report.skipped_images += 1
        report.issues.append(
            ImportIssue(
                path=str(image_path),
                issue_type="duplicate_image",
                message="Image filename already exists in this dataset.",
            )
        )
        return None

    storage_name = f"{uuid4()}{image_path.suffix.lower()}"
    storage_path = import_root / storage_name
    try:
        shutil.copy2(image_path, storage_path)
        width, height = read_image_size(storage_path)
    except HTTPException as exc:
        report.skipped_images += 1
        report.issues.append(
            ImportIssue(path=str(image_path), issue_type="unreadable_image", message=str(exc.detail))
        )
        return None

    media_item = models.MediaItem(
        dataset_id=dataset_id,
        file_name=image_path.name,
        storage_key=f"uploads/{dataset_id}/{storage_name}",
        media_type=MediaType.IMAGE.value,
        source_path=str(image_path),
        import_session_id=import_session_id,
        width=width,
        height=height,
    )
    db.add(media_item)
    db.flush()
    existing_names.add(image_path.name)
    report.imported_images += 1
    return media_item


def import_video_file(
    db: Session,
    dataset_id: UUID,
    video_path: Path,
    import_root: Path,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
    existing_names: set[str],
    import_session_id: UUID,
) -> models.MediaItem | None:
    if payload.duplicate_policy == DuplicatePolicy.SKIP and video_path.name in existing_names:
        report.skipped_images += 1
        report.issues.append(
            ImportIssue(
                path=str(video_path),
                issue_type="duplicate_video",
                message="Video filename already exists in this dataset.",
            )
        )
        return None

    storage_name = f"{uuid4()}{video_path.suffix.lower()}"
    storage_path = import_root / storage_name
    shutil.copy2(video_path, storage_path)
    width, height, _fps, _frame_count = read_video_metadata(storage_path)
    media_item = models.MediaItem(
        dataset_id=dataset_id,
        file_name=video_path.name,
        storage_key=f"uploads/{dataset_id}/{storage_name}",
        media_type=MediaType.VIDEO.value,
        source_path=str(video_path),
        import_session_id=import_session_id,
        width=width,
        height=height,
    )
    db.add(media_item)
    db.flush()
    existing_names.add(video_path.name)
    report.imported_videos += 1
    return media_item


def read_video_metadata(path: Path) -> tuple[int, int, float, int]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise HTTPException(status_code=400, detail="Uploaded file is not a readable video")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 1)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    capture.release()
    return width, height, fps, frame_count


def extract_video_frames(
    db: Session,
    dataset_id: UUID,
    video_item: models.MediaItem,
    video_path: Path,
    frame_root: Path,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
    import_session_id: UUID,
) -> list[models.MediaItem]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        report.issues.append(
            ImportIssue(path=str(video_path), issue_type="unreadable_video", message="Could not open video")
        )
        return []

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 25)
    step = max(1, int(fps * payload.video_sample_every_seconds))
    frames: list[models.MediaItem] = []
    frame_number = 0
    saved_index = 0
    video_frame_root = frame_root / str(video_item.id)
    video_frame_root.mkdir(parents=True, exist_ok=True)

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_number % step == 0:
            timestamp = frame_number / fps if fps else 0
            frame_name = f"{video_path.stem}_frame_{saved_index:06d}.jpg"
            frame_path = video_frame_root / frame_name
            cv2.imwrite(str(frame_path), frame)
            height, width = frame.shape[:2]
            frame_item = models.MediaItem(
                dataset_id=dataset_id,
                file_name=frame_name,
                storage_key=f"frames/{dataset_id}/{video_item.id}/{frame_name}",
                media_type=MediaType.IMAGE.value,
                source_path=str(video_path),
                import_session_id=import_session_id,
                parent_media_id=video_item.id,
                width=int(width),
                height=int(height),
                frame_index=saved_index,
                timestamp_seconds=float(timestamp),
            )
            db.add(frame_item)
            db.flush()
            frames.append(frame_item)
            report.imported_frames += 1
            saved_index += 1
        frame_number += 1

    capture.release()
    return frames


def import_labels_for_media(
    db: Session,
    media_item: models.MediaItem,
    label_path: Path,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
) -> None:
    if not label_path.exists():
        report.issues.append(
            ImportIssue(
                path=str(label_path),
                issue_type="missing_label",
                message="No YOLO label file was found for this image.",
            )
        )
        return

    text = label_path.read_text(encoding="utf-8").strip()
    if not text:
        report.issues.append(
            ImportIssue(
                path=str(label_path),
                issue_type="empty_label",
                message="Label file exists but contains no annotations.",
            )
        )
        return

    try:
        labels = parse_label_file(text, payload.task)
    except YoloLabelError as exc:
        report.issues.append(
            ImportIssue(
                path=str(label_path),
                issue_type="corrupted_label",
                message=str(exc),
            )
        )
        return

    for label in labels:
        db.add(
            models.Annotation(
                media_id=media_item.id,
                task=payload.task,
                class_id=label.class_id,
                x_center=label.box.x_center,
                y_center=label.box.y_center,
                width=label.box.width,
                height=label.box.height,
                source=AnnotationSource.IMPORT,
                status=AnnotationStatus.ACCEPTED,
                is_prefetched=True,
            )
        )
        report.imported_annotations += 1


def media_to_read(item: models.MediaItem) -> MediaRead:
    return MediaRead(
        id=item.id,
        dataset_id=item.dataset_id,
        file_name=item.file_name,
        image_url=f"/storage/{item.storage_key}",
        media_type=item.media_type or MediaType.IMAGE,
        width=item.width or 1,
        height=item.height or 1,
        frame_index=item.frame_index,
        timestamp_seconds=item.timestamp_seconds,
        source_path=item.source_path,
        parent_media_id=item.parent_media_id,
        created_at=item.created_at,
    )


def import_session_to_read(session: models.ImportSession) -> ImportSessionRead:
    return ImportSessionRead(
        id=session.id,
        dataset_id=session.dataset_id,
        parent_dir=session.parent_dir,
        image_dir=session.image_dir,
        video_dir=session.video_dir,
        label_dir=session.label_dir,
        source_type=session.source_type,
        task=session.task,
        duplicate_policy=session.duplicate_policy,
        imported_images=session.imported_images,
        imported_videos=session.imported_videos,
        imported_frames=session.imported_frames,
        imported_annotations=session.imported_annotations,
        model_annotations=session.model_annotations,
        skipped_images=session.skipped_images,
        issue_count=session.issue_count,
        created_at=session.created_at,
    )
