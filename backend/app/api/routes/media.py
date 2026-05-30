import re
import shutil
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from threading import Lock
from uuid import UUID
from uuid import uuid4

import cv2
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.db.session import SessionLocal, get_db
from app.domain.classes import AnnotationTask
from app.domain.schemas import AnnotationSource, AnnotationStatus
from app.domain.schemas import (
    DuplicatePolicy,
    DirectoryEntryRead,
    FrameExtractionCreate,
    ImportSourceType,
    ImportIssue,
    ImportSessionRead,
    ImportSessionsDeleteCreate,
    JobStatus,
    MediaType,
    MediaRead,
    ProcessingJobRead,
    ServerFolderImportCreate,
    ServerFolderImportRead,
    ServerFolderScanRead,
)
from app.services.model_registry import is_base_model_key, model_path_for_key
from app.services.yolo_labels import YoloLabelError, parse_label_file

router = APIRouter()
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}
YOLO_IMAGE_SIZE = 960
YOLO_BATCH_SIZE = 16
FRAME_EXTRACTION_WORKERS = 2
FRAME_EXTRACTION_EXECUTOR = ThreadPoolExecutor(max_workers=FRAME_EXTRACTION_WORKERS)
FRAME_JOBS: dict[UUID, ProcessingJobRead] = {}
FRAME_JOBS_LOCK = Lock()


@router.get("/item/{media_id}/content")
def read_media_content(media_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    media_item = db.get(models.MediaItem, media_id)
    if media_item is None:
        raise HTTPException(status_code=404, detail="Media item not found")
    media_path = path_for_media(media_item)
    if not media_path.exists() or not media_path.is_file():
        raise HTTPException(status_code=404, detail="Media file is not available on this server")
    return FileResponse(media_path)


@router.get("/{dataset_id}/items", response_model=list[MediaRead])
def list_media_items(dataset_id: UUID, db: Session = Depends(get_db)) -> list[MediaRead]:
    ensure_dataset(db, dataset_id)
    items = db.scalars(
        select(models.MediaItem)
        .where(models.MediaItem.dataset_id == dataset_id)
        .order_by(models.MediaItem.created_at.asc())
    ).all()
    return [media_to_read(item) for item in items]


@router.delete("/item/{media_id}", response_model=ProcessingJobRead)
def delete_media_item(media_id: UUID, db: Session = Depends(get_db)) -> ProcessingJobRead:
    media_item = db.get(models.MediaItem, media_id)
    if media_item is None:
        raise HTTPException(status_code=404, detail="Media item not found")

    child_items = db.scalars(
        select(models.MediaItem).where(models.MediaItem.parent_media_id == media_item.id)
    ).all()
    media_ids = [item.id for item in child_items] + [media_item.id]
    remove_generated_frame_files([*child_items, media_item])
    db.execute(delete(models.Annotation).where(models.Annotation.media_id.in_(media_ids)))
    db.execute(delete(models.MediaItem).where(models.MediaItem.id.in_(media_ids)))
    db.commit()

    removed_count = len(media_ids)
    return ProcessingJobRead(
        kind="media_delete",
        status="completed",
        message=f"Deleted {removed_count} media item{'' if removed_count == 1 else 's'}",
    )


@router.post("/{dataset_id}/import-sessions/delete", response_model=ProcessingJobRead)
def delete_import_sessions(
    dataset_id: UUID,
    payload: ImportSessionsDeleteCreate,
    db: Session = Depends(get_db),
) -> ProcessingJobRead:
    ensure_dataset(db, dataset_id)
    session_ids = set(payload.session_ids)
    sessions = db.scalars(
        select(models.ImportSession).where(
            models.ImportSession.dataset_id == dataset_id,
            models.ImportSession.id.in_(session_ids),
        )
    ).all()
    if len(sessions) != len(session_ids):
        raise HTTPException(status_code=404, detail="Import folder not found")

    media_items = db.scalars(
        select(models.MediaItem).where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.import_session_id.in_(session_ids),
        )
    ).all()
    parent_media_ids = [item.id for item in media_items if item.media_type == MediaType.VIDEO.value]
    if parent_media_ids:
        child_items = db.scalars(
            select(models.MediaItem).where(
                models.MediaItem.dataset_id == dataset_id,
                models.MediaItem.parent_media_id.in_(parent_media_ids),
            )
        ).all()
        media_items = list({item.id: item for item in [*media_items, *child_items]}.values())
    media_ids = [item.id for item in media_items]
    remove_generated_frame_files(media_items)
    if media_ids:
        db.execute(delete(models.Annotation).where(models.Annotation.media_id.in_(media_ids)))
        db.execute(delete(models.MediaItem).where(models.MediaItem.id.in_(media_ids)))
    db.execute(delete(models.ImportSession).where(models.ImportSession.id.in_(session_ids)))
    db.commit()

    removed_count = len(media_ids)
    return ProcessingJobRead(
        kind="import_folder_delete",
        status="completed",
        message=f"Deleted {removed_count} media record{'' if removed_count == 1 else 's'}",
    )


@router.get("/{dataset_id}/import-history", response_model=list[ImportSessionRead])
def list_import_history(dataset_id: UUID, db: Session = Depends(get_db)) -> list[ImportSessionRead]:
    ensure_dataset(db, dataset_id)
    sessions = db.scalars(
        select(models.ImportSession)
        .where(models.ImportSession.dataset_id == dataset_id)
        .order_by(models.ImportSession.created_at.desc())
    ).all()
    return [import_session_to_read(session) for session in sessions]


@router.get("/directories", response_model=DirectoryEntryRead)
def browse_directories(path: str | None = None) -> DirectoryEntryRead:
    current = Path(path).expanduser() if path else Path.home()
    if not current.exists() or not current.is_dir():
        raise HTTPException(status_code=400, detail="Directory path does not exist on server")
    try:
        resolved = current.resolve()
        directories = sorted(
            item.name
            for item in resolved.iterdir()
            if item.is_dir() and not item.name.startswith(".")
        )
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DirectoryEntryRead(
        path=str(resolved),
        name=resolved.name or str(resolved),
        parent=str(resolved.parent) if resolved.parent != resolved else None,
        directories=directories,
    )


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
        label_paths_by_stem = build_label_index(label_dir) if label_dir is not None else {}
        for image_path in sorted(image_dir.rglob("*")):
            if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            media_item = import_image_file(
                db,
                dataset_id,
                image_path,
                payload,
                report,
                existing_names,
                import_session.id,
            )
            if media_item is None:
                continue
            saved_items.append(media_item)
            if label_dir is not None:
                import_labels_for_media(
                    db,
                    media_item,
                    label_paths_by_stem.get(image_path.stem, label_dir / f"{image_path.stem}.txt"),
                    payload,
                    report,
                )
            if payload.auto_annotate:
                for task in tasks_for_payload(payload):
                    model_key = payload.vehicle_model_key if task == AnnotationTask.VEHICLE else payload.plate_model_key
                    auto_annotate_image(db, media_item, payload.model_copy(update={"task": task}), report, model_key)

    if payload.import_videos and video_dir is not None:
        for video_path in sorted(video_dir.rglob("*")):
            if not video_path.is_file() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            video_item = import_video_file(
                db,
                dataset_id,
                video_path,
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
                        for task in tasks_for_payload(payload):
                            model_key = payload.vehicle_model_key if task == AnnotationTask.VEHICLE else payload.plate_model_key
                            auto_annotate_image(db, frame_item, payload.model_copy(update={"task": task}), report, model_key)

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


@router.post("/{dataset_id}/server-folder/scan", response_model=ServerFolderScanRead)
def scan_server_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderScanRead:
    ensure_dataset(db, dataset_id)
    image_dir, video_dir, label_dir, parent_dir = resolve_import_paths(payload)
    report = ServerFolderScanRead(
        parent_dir=str(parent_dir) if parent_dir else None,
        image_dir=str(image_dir) if image_dir else None,
        video_dir=str(video_dir) if video_dir else None,
        label_dir=str(label_dir) if label_dir else None,
    )

    image_paths: list[Path] = []
    if payload.import_images:
        if image_dir is None or not image_dir.is_dir():
            report.issues.append(
                ImportIssue(
                    path=str(image_dir) if image_dir else "",
                    issue_type="missing_image_folder",
                    message="Image folder does not exist on server.",
                )
            )
        else:
            image_paths = [
                path
                for path in image_dir.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            ]
            report.image_count = len(image_paths)

    if payload.import_videos:
        if video_dir is None or not video_dir.is_dir():
            report.issues.append(
                ImportIssue(
                    path=str(video_dir) if video_dir else "",
                    issue_type="missing_video_folder",
                    message="Video folder does not exist on server.",
                )
            )
        else:
            report.video_count = sum(
                1
                for path in video_dir.rglob("*")
                if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
            )

    if label_dir is not None:
        if not label_dir.is_dir():
            report.issues.append(
                ImportIssue(
                    path=str(label_dir),
                    issue_type="missing_label_folder",
                    message="Label folder does not exist on server.",
                )
            )
        else:
            label_stems = {
                path.stem
                for path in label_dir.rglob("*.txt")
                if path.is_file()
            }
            image_stems = {path.stem for path in image_paths}
            report.label_count = len(label_stems)
            report.matched_label_count = len(image_stems & label_stems)
            report.missing_label_count = max(0, len(image_stems - label_stems))

    return report


@router.post("/{dataset_id}/image-folder/scan", response_model=ServerFolderScanRead)
def scan_image_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderScanRead:
    image_payload = payload.model_copy(
        update={
            "source_type": ImportSourceType.IMAGE_FOLDER,
            "import_images": True,
            "import_videos": False,
            "extract_video_frames": False,
        }
    )
    return scan_server_folder(dataset_id, image_payload, db)


@router.post("/{dataset_id}/image-folder/import", response_model=ServerFolderImportRead)
def import_image_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderImportRead:
    image_payload = payload.model_copy(
        update={
            "source_type": ImportSourceType.IMAGE_FOLDER,
            "import_images": True,
            "import_videos": False,
            "extract_video_frames": False,
        }
    )
    return import_server_folder(dataset_id, image_payload, db)


@router.post("/{dataset_id}/video-folder/scan", response_model=ServerFolderScanRead)
def scan_video_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderScanRead:
    video_payload = payload.model_copy(
        update={
            "source_type": ImportSourceType.VIDEO_FOLDER,
            "import_images": False,
            "import_videos": True,
        }
    )
    return scan_server_folder(dataset_id, video_payload, db)


@router.post("/{dataset_id}/video-folder/import", response_model=ServerFolderImportRead)
def import_video_folder(
    dataset_id: UUID,
    payload: ServerFolderImportCreate,
    db: Session = Depends(get_db),
) -> ServerFolderImportRead:
    video_payload = payload.model_copy(
        update={
            "source_type": ImportSourceType.VIDEO_FOLDER,
            "import_images": False,
            "import_videos": True,
        }
    )
    return import_server_folder(dataset_id, video_payload, db)


@router.post("/{dataset_id}/videos", response_model=ProcessingJobRead)
async def upload_video(dataset_id: UUID, video: UploadFile) -> ProcessingJobRead:
    _ = (dataset_id, video)
    return ProcessingJobRead(kind="video_processing", message="Video processing queued")


@router.post("/{media_id}/extract-frames", response_model=ProcessingJobRead)
def extract_frames_for_video(
    media_id: UUID,
    payload: FrameExtractionCreate,
    db: Session = Depends(get_db),
) -> ProcessingJobRead:
    video_item = db.get(models.MediaItem, media_id)
    if video_item is None:
        raise HTTPException(status_code=404, detail="Video not found")
    if video_item.media_type != MediaType.VIDEO.value:
        raise HTTPException(status_code=400, detail="Selected media is not a video")

    job = ProcessingJobRead(
        kind="frame_extraction",
        status=JobStatus.QUEUED,
        message=f"Queued frame extraction for {video_item.file_name}",
    )
    set_frame_job(job)
    FRAME_EXTRACTION_EXECUTOR.submit(run_frame_extraction_job, job.id, media_id, payload)
    return job


@router.get("/frame-extraction-jobs/{job_id}", response_model=ProcessingJobRead)
def read_frame_extraction_job(job_id: UUID) -> ProcessingJobRead:
    with FRAME_JOBS_LOCK:
        job = FRAME_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Frame extraction job not found")
    return job


def run_frame_extraction_job(job_id: UUID, media_id: UUID, payload: FrameExtractionCreate) -> None:
    db = SessionLocal()
    try:
        update_frame_job(job_id, status=JobStatus.RUNNING, message="Preparing video")
        video_item = db.get(models.MediaItem, media_id)
        if video_item is None:
            update_frame_job(job_id, status=JobStatus.FAILED, message="Video not found")
            return
        if video_item.media_type != MediaType.VIDEO.value:
            update_frame_job(job_id, status=JobStatus.FAILED, message="Selected media is not a video")
            return

        result = extract_frames_for_video_sync(video_item, payload, db, job_id)
        update_frame_job(
            job_id,
            status=JobStatus.COMPLETED,
            message=result.message,
            progress_percent=100,
            progress_current=max(1, get_frame_job(job_id).progress_total),
            progress_total=max(1, get_frame_job(job_id).progress_total),
        )
    except Exception as exc:
        db.rollback()
        update_frame_job(job_id, status=JobStatus.FAILED, message=str(exc))
    finally:
        db.close()


def extract_frames_for_video_sync(
    video_item: models.MediaItem,
    payload: FrameExtractionCreate,
    db: Session,
    job_id: UUID | None = None,
) -> ProcessingJobRead:
    video_path = path_for_media(video_item)
    frame_root = settings.storage_root / "frames" / str(video_item.dataset_id)
    frame_root.mkdir(parents=True, exist_ok=True)
    tasks = payload.tasks or [payload.task]
    primary_task = tasks[0]
    report = ServerFolderImportRead(task=primary_task)
    import_session = models.ImportSession(
        dataset_id=video_item.dataset_id,
        parent_dir=None,
        image_dir="",
        video_dir=video_item.source_path or video_item.file_name,
        label_dir=None,
        source_type=ImportSourceType.VIDEO_FOLDER,
        task=primary_task,
        duplicate_policy=DuplicatePolicy.IMPORT_COPY,
    )
    db.add(import_session)
    db.flush()

    frames = extract_video_frames(
        db,
        video_item.dataset_id,
        video_item,
        video_path,
        frame_root,
        ServerFolderImportCreate(
            task=primary_task,
            tasks=tasks,
            video_sample_every_seconds=payload.sample_every_seconds,
            vehicle_model_key=payload.vehicle_model_key,
            plate_model_key=payload.plate_model_key,
        ),
        report,
        import_session.id,
        (lambda current, total: update_frame_progress(job_id, current, total)) if job_id else None,
    )
    if payload.auto_annotate:
        for frame_item in frames:
            for task in tasks:
                model_key = payload.vehicle_model_key if task == AnnotationTask.VEHICLE else payload.plate_model_key
                auto_annotate_image(db, frame_item, ServerFolderImportCreate(task=task), report, model_key)

    import_session.imported_frames = report.imported_frames
    import_session.model_annotations = report.model_annotations
    import_session.issue_count = len(report.issues)
    db.commit()

    return ProcessingJobRead(
        kind="frame_extraction",
        status=JobStatus.COMPLETED,
        message=f"Extracted {report.imported_frames} frames and created {report.model_annotations} AI boxes",
        progress_percent=100,
    )


@router.post("/{media_id}/auto-annotate", response_model=ProcessingJobRead)
def auto_annotate_media(
    media_id: UUID,
    task: AnnotationTask = AnnotationTask.VEHICLE,
    model_key: str | None = None,
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
            auto_annotate_image(db, target, payload, report, model_key)

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
    model_key: str | None,
) -> None:
    model_path = model_path_for_key(model_key, payload.task)
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

        model = yolo_model(str(model_path))
        image_path = path_for_media(media_item)
        results = model.predict(
            str(image_path),
            verbose=False,
            device=inference_device(),
            half=inference_half_precision(),
            imgsz=YOLO_IMAGE_SIZE,
        )
    except Exception as exc:
        report.issues.append(
            ImportIssue(
                path=media_item.file_name,
                issue_type="model_inference_failed",
                message=str(exc),
            )
        )
        return

    existing_boxes = [
        {
            "task": annotation.task,
            "class_id": annotation.class_id,
            "x_center": annotation.x_center,
            "y_center": annotation.y_center,
            "width": annotation.width,
            "height": annotation.height,
        }
        for annotation in db.scalars(
            select(models.Annotation).where(
                models.Annotation.media_id == media_item.id,
                models.Annotation.task == payload.task,
            )
        ).all()
    ]

    for result in results:
        image_width = float(result.orig_shape[1])
        image_height = float(result.orig_shape[0])
        for box in result.boxes:
            raw_class_id = int(box.cls.item())
            class_id = map_model_class(payload.task, raw_class_id, model_key)
            if class_id is None:
                continue
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = [float(value) for value in xyxy]
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)
            if width <= 0 or height <= 0:
                continue
            normalized_box = {
                "task": payload.task,
                "class_id": class_id,
                "x_center": (x1 + width / 2) / image_width,
                "y_center": (y1 + height / 2) / image_height,
                "width": width / image_width,
                "height": height / image_height,
            }
            if has_duplicate_annotation(existing_boxes, normalized_box):
                continue
            db.add(
                models.Annotation(
                    media_id=media_item.id,
                    task=payload.task,
                    class_id=class_id,
                    x_center=normalized_box["x_center"],
                    y_center=normalized_box["y_center"],
                    width=normalized_box["width"],
                    height=normalized_box["height"],
                    confidence=float(box.conf.item()),
                    source=AnnotationSource.MODEL,
                    status=AnnotationStatus.DRAFT,
                    is_prefetched=False,
                )
            )
            existing_boxes.append(normalized_box)
            report.model_annotations += 1


def has_duplicate_annotation(
    existing_boxes: list[dict[str, object]],
    candidate: dict[str, object],
    iou_threshold: float = 0.85,
) -> bool:
    return any(
        existing["task"] == candidate["task"]
        and existing["class_id"] == candidate["class_id"]
        and box_iou(existing, candidate) >= iou_threshold
        for existing in existing_boxes
    )


def box_iou(first: dict[str, object], second: dict[str, object]) -> float:
    first_x1, first_y1, first_x2, first_y2 = box_to_corners(first)
    second_x1, second_y1, second_x2, second_y2 = box_to_corners(second)
    intersection_width = max(0.0, min(first_x2, second_x2) - max(first_x1, second_x1))
    intersection_height = max(0.0, min(first_y2, second_y2) - max(first_y1, second_y1))
    intersection = intersection_width * intersection_height
    first_area = max(0.0, first_x2 - first_x1) * max(0.0, first_y2 - first_y1)
    second_area = max(0.0, second_x2 - second_x1) * max(0.0, second_y2 - second_y1)
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def box_to_corners(box: dict[str, object]) -> tuple[float, float, float, float]:
    x_center = float(box["x_center"])
    y_center = float(box["y_center"])
    width = float(box["width"])
    height = float(box["height"])
    return (
        x_center - width / 2,
        y_center - height / 2,
        x_center + width / 2,
        y_center + height / 2,
    )


def map_model_class(
    task: AnnotationTask,
    raw_class_id: int,
    model_key: str | None,
) -> int | None:
    if task == AnnotationTask.PLATE:
        return raw_class_id if not is_base_model_key(model_key) and raw_class_id == 0 else None

    if is_base_model_key(model_key):
        coco_to_vehicle = {
            1: 1,
            3: 1,
            2: 2,
            5: 3,
            7: 4,
        }
        return coco_to_vehicle.get(raw_class_id)

    return raw_class_id if raw_class_id in {1, 2, 3, 4} else None


def tasks_for_payload(payload: ServerFolderImportCreate) -> list[AnnotationTask]:
    if payload.tasks:
        ordered: list[AnnotationTask] = []
        for task in payload.tasks:
            if task not in ordered:
                ordered.append(task)
        return ordered
    return [payload.task]


def inference_device() -> str | None:
    try:
        import torch

        return "cuda:0" if torch.cuda.is_available() else None
    except Exception:
        return None


def inference_half_precision() -> bool:
    return inference_device() is not None


@lru_cache(maxsize=8)
def yolo_model(model_path: str):
    from ultralytics import YOLO

    model = YOLO(model_path)
    if inference_device() is not None:
        try:
            model.to(inference_device())
        except Exception:
            pass
    return model


def path_for_media(item: models.MediaItem) -> Path:
    storage_key_path = Path(item.storage_key)
    storage_path = storage_key_path if storage_key_path.is_absolute() else settings.storage_root / storage_key_path
    if storage_path.exists():
        return storage_path
    if item.media_type == MediaType.IMAGE.value and item.parent_media_id is not None:
        return storage_path

    if item.source_path:
        source_path = Path(item.source_path)
        if source_path.exists():
            return source_path

    return storage_path


def remove_generated_frame_files(items: list[models.MediaItem]) -> None:
    storage_root = settings.storage_root.resolve()
    removable_paths: list[Path] = []
    for item in items:
        if item.media_type != MediaType.IMAGE.value or item.parent_media_id is None:
            continue
        storage_key_path = Path(item.storage_key)
        if storage_key_path.is_absolute():
            continue
        if not storage_key_path.parts or storage_key_path.parts[0] != "frames":
            continue
        frame_path = (settings.storage_root / storage_key_path).resolve()
        if not frame_path.is_relative_to(storage_root):
            continue
        if frame_path.exists() and frame_path.is_file():
            try:
                frame_path.unlink()
                removable_paths.append(frame_path.parent)
            except OSError:
                continue

    frame_root = (settings.storage_root / "frames").resolve()
    for directory in sorted(set(removable_paths), key=lambda path: len(path.parts), reverse=True):
        current = directory
        while current != frame_root and current.is_relative_to(frame_root):
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent


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

    try:
        width, height = read_image_size(image_path)
    except HTTPException as exc:
        report.skipped_images += 1
        report.issues.append(
            ImportIssue(path=str(image_path), issue_type="unreadable_image", message=str(exc.detail))
        )
        return None

    media_item = models.MediaItem(
        dataset_id=dataset_id,
        file_name=image_path.name,
        storage_key=str(image_path),
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

    width, height, _fps, _frame_count = read_video_metadata(video_path)
    media_item = models.MediaItem(
        dataset_id=dataset_id,
        file_name=video_path.name,
        storage_key=str(video_path),
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


def safe_path_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return cleaned or "video"


def set_frame_job(job: ProcessingJobRead) -> None:
    with FRAME_JOBS_LOCK:
        FRAME_JOBS[job.id] = job


def get_frame_job(job_id: UUID) -> ProcessingJobRead:
    with FRAME_JOBS_LOCK:
        return FRAME_JOBS[job_id]


def update_frame_job(job_id: UUID, **updates: object) -> None:
    with FRAME_JOBS_LOCK:
        job = FRAME_JOBS.get(job_id)
        if job is None:
            return
        for key, value in updates.items():
            setattr(job, key, value)


def update_frame_progress(job_id: UUID | None, current: int, total: int) -> None:
    if job_id is None:
        return
    bounded_total = max(1, total)
    bounded_current = min(max(0, current), bounded_total)
    update_frame_job(
        job_id,
        progress_current=bounded_current,
        progress_total=bounded_total,
        progress_percent=round((bounded_current / bounded_total) * 100),
        message=f"Extracting frames {round((bounded_current / bounded_total) * 100)}%",
    )


def extract_video_frames(
    db: Session,
    dataset_id: UUID,
    video_item: models.MediaItem,
    video_path: Path,
    frame_root: Path,
    payload: ServerFolderImportCreate,
    report: ServerFolderImportRead,
    import_session_id: UUID,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[models.MediaItem]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        report.issues.append(
            ImportIssue(path=str(video_path), issue_type="unreadable_video", message="Could not open video")
        )
        return []

    detector = load_vehicle_frame_detector(payload, report)
    if detector is None:
        capture.release()
        return []

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 25)
    step = max(1, int(fps * payload.video_sample_every_seconds))
    frames: list[models.MediaItem] = []
    frame_number = 0
    saved_index = 0
    previous_detections: list[dict[str, float]] | None = None
    existing_timestamps = {
        int((timestamp or 0) * 1000)
        for timestamp in db.scalars(
            select(models.MediaItem.timestamp_seconds).where(models.MediaItem.parent_media_id == video_item.id)
        ).all()
        if timestamp is not None
    }
    safe_video_name = safe_path_name(video_path.stem or Path(video_item.file_name).stem)
    frame_folder_name = f"{safe_video_name}_{str(video_item.id)[:8]}"
    video_frame_root = frame_root / frame_folder_name
    video_frame_root.mkdir(parents=True, exist_ok=True)

    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    total_samples = max(1, ((total_frames - 1) // step) + 1) if total_frames > 0 else 1
    processed_samples = 0
    if progress_callback:
        progress_callback(processed_samples, total_samples)

    while total_frames <= 0 or frame_number < total_frames:
        batch_frames = []
        batch_numbers = []
        for _ in range(YOLO_BATCH_SIZE):
            if total_frames > 0 and frame_number >= total_frames:
                break
            if step > 1:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ok, frame = capture.read()
            if not ok:
                break
            batch_frames.append(frame)
            batch_numbers.append(frame_number)
            frame_number += step
        if not batch_frames:
            break

        batch_detections = detect_vehicle_boxes_batch(detector, batch_frames, payload.vehicle_model_key)
        for frame, sampled_frame_number, detections in zip(batch_frames, batch_numbers, batch_detections):
            processed_samples += 1
            if not should_save_video_frame(detections, previous_detections):
                continue
            timestamp = sampled_frame_number / fps if fps else 0
            timestamp_ms = int(timestamp * 1000)
            if timestamp_ms in existing_timestamps:
                continue
            frame_name = f"{safe_video_name}_frame_{saved_index + 1:06d}_{timestamp_ms:010d}ms.jpg"
            frame_path = video_frame_root / frame_name
            cv2.imwrite(str(frame_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
            height, width = frame.shape[:2]
            frame_item = models.MediaItem(
                dataset_id=dataset_id,
                file_name=frame_name,
                storage_key=f"frames/{dataset_id}/{frame_folder_name}/{frame_name}",
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
            existing_timestamps.add(timestamp_ms)
            previous_detections = detections
        if progress_callback:
            progress_callback(processed_samples, total_samples)

    capture.release()
    return frames


def load_vehicle_frame_detector(payload: ServerFolderImportCreate, report: ServerFolderImportRead):
    model_path = model_path_for_key(payload.vehicle_model_key, AnnotationTask.VEHICLE)
    if not model_path.exists():
        report.issues.append(
            ImportIssue(
                path=str(model_path),
                issue_type="missing_vehicle_model",
                message="Smart video frame capture needs a vehicle model.",
            )
        )
        return None
    try:
        return yolo_model(str(model_path))
    except Exception as exc:
        report.issues.append(
            ImportIssue(
                path=str(model_path),
                issue_type="vehicle_model_load_failed",
                message=f"Smart video frame capture could not load the vehicle model: {exc}",
            )
        )
        return None


def detect_vehicle_boxes(detector, frame, model_key: str | None) -> list[dict[str, float]]:
    return detect_vehicle_boxes_batch(detector, [frame], model_key)[0]


def detect_vehicle_boxes_batch(detector, frames: list[object], model_key: str | None) -> list[list[dict[str, float]]]:
    if not frames:
        return []
    try:
        results = detector.predict(
            frames,
            verbose=False,
            device=inference_device(),
            half=inference_half_precision(),
            imgsz=YOLO_IMAGE_SIZE,
            batch=min(YOLO_BATCH_SIZE, len(frames)),
        )
    except Exception:
        return [[] for _ in frames]

    detections_by_frame: list[list[dict[str, float]]] = []
    for result in results:
        detections: list[dict[str, float]] = []
        image_height, image_width = result.orig_shape[:2]
        for box in result.boxes:
            if map_model_class(AnnotationTask.VEHICLE, int(box.cls.item()), model_key) is None:
                continue
            x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)
            if width <= 0 or height <= 0:
                continue
            detections.append(
                {
                    "x_center": (x1 + width / 2) / float(image_width),
                    "y_center": (y1 + height / 2) / float(image_height),
                    "width": width / float(image_width),
                    "height": height / float(image_height),
                }
            )
        detections_by_frame.append(detections)
    while len(detections_by_frame) < len(frames):
        detections_by_frame.append([])
    return detections_by_frame


def should_save_video_frame(
    detections: list[dict[str, float]],
    previous_detections: list[dict[str, float]] | None,
) -> bool:
    if not detections:
        return False
    if previous_detections is None:
        return True
    if len(detections) != len(previous_detections):
        return True
    return any(
        max((box_iou(detection, previous) for previous in previous_detections), default=0.0) < 0.65
        for detection in detections
    )


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


def build_label_index(label_dir: Path) -> dict[str, Path]:
    labels: dict[str, Path] = {}
    for label_path in sorted(label_dir.rglob("*.txt")):
        if label_path.is_file() and label_path.stem not in labels:
            labels[label_path.stem] = label_path
    return labels


def media_to_read(item: models.MediaItem) -> MediaRead:
    return MediaRead(
        id=item.id,
        dataset_id=item.dataset_id,
        file_name=item.file_name,
        image_url=f"/api/media/item/{item.id}/content",
        media_type=item.media_type or MediaType.IMAGE,
        width=item.width or 1,
        height=item.height or 1,
        frame_index=item.frame_index,
        timestamp_seconds=item.timestamp_seconds,
        source_path=item.source_path,
        import_session_id=item.import_session_id,
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
