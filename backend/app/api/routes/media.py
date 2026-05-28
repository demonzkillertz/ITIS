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
from app.domain.schemas import AnnotationSource, AnnotationStatus
from app.domain.schemas import (
    DuplicatePolicy,
    ImportIssue,
    ImportSessionRead,
    MediaRead,
    ProcessingJobRead,
    ServerFolderImportCreate,
    ServerFolderImportRead,
)
from app.services.yolo_labels import YoloLabelError, parse_label_file

router = APIRouter()
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


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
    image_dir, label_dir, parent_dir = resolve_import_paths(payload)

    if not image_dir.exists() or not image_dir.is_dir():
        raise HTTPException(status_code=400, detail="Image folder path does not exist on server")
    if label_dir and (not label_dir.exists() or not label_dir.is_dir()):
        raise HTTPException(status_code=400, detail="Label folder path does not exist on server")

    import_root = settings.storage_root / "uploads" / str(dataset_id)
    import_root.mkdir(parents=True, exist_ok=True)
    report = ServerFolderImportRead(
        parent_dir=str(parent_dir) if parent_dir else None,
        image_dir=str(image_dir),
        label_dir=str(label_dir) if label_dir else None,
        task=payload.task,
        duplicate_policy=payload.duplicate_policy,
    )
    saved_items: list[models.MediaItem] = []
    existing_names = set(
        db.scalars(select(models.MediaItem.file_name).where(models.MediaItem.dataset_id == dataset_id))
    )

    for image_path in sorted(image_dir.rglob("*")):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        if payload.duplicate_policy == DuplicatePolicy.SKIP and image_path.name in existing_names:
            report.skipped_images += 1
            report.issues.append(
                ImportIssue(
                    path=str(image_path),
                    issue_type="duplicate_image",
                    message="Image filename already exists in this dataset.",
                )
            )
            continue

        storage_name = f"{uuid4()}{image_path.suffix.lower()}"
        storage_path = import_root / storage_name
        try:
            shutil.copy2(image_path, storage_path)
            width, height = read_image_size(storage_path)
        except HTTPException as exc:
            report.skipped_images += 1
            report.issues.append(
                ImportIssue(
                    path=str(image_path),
                    issue_type="unreadable_image",
                    message=str(exc.detail),
                )
            )
            continue

        media_item = models.MediaItem(
            dataset_id=dataset_id,
            file_name=image_path.name,
            storage_key=f"uploads/{dataset_id}/{storage_name}",
            width=width,
            height=height,
        )
        db.add(media_item)
        db.flush()
        saved_items.append(media_item)
        existing_names.add(image_path.name)
        report.imported_images += 1

        if label_dir is not None:
            label_path = label_dir / f"{image_path.stem}.txt"
            import_labels_for_media(db, media_item, label_path, payload, report)

    import_session = models.ImportSession(
        dataset_id=dataset_id,
        parent_dir=report.parent_dir,
        image_dir=report.image_dir or "",
        label_dir=report.label_dir,
        task=payload.task,
        duplicate_policy=payload.duplicate_policy,
        imported_images=report.imported_images,
        imported_annotations=report.imported_annotations,
        skipped_images=report.skipped_images,
        issue_count=len(report.issues),
    )
    db.add(import_session)
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
def auto_annotate_media(media_id: UUID) -> ProcessingJobRead:
    _ = media_id
    return ProcessingJobRead(kind="auto_annotation", message="Inference queued")


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


def resolve_import_paths(payload: ServerFolderImportCreate) -> tuple[Path, Path | None, Path | None]:
    parent_dir = Path(payload.parent_dir).expanduser() if payload.parent_dir else None
    explicit_image_dir = Path(payload.image_dir).expanduser() if payload.image_dir else None
    explicit_label_dir = Path(payload.label_dir).expanduser() if payload.label_dir else None

    if payload.mode == "explicit":
        if explicit_image_dir is None:
            raise HTTPException(status_code=400, detail="Image folder is required in explicit mode")
        return explicit_image_dir, explicit_label_dir, parent_dir

    if parent_dir is not None:
        images_child = parent_dir / "images"
        labels_child = parent_dir / "labels"
        image_dir = images_child if images_child.is_dir() else parent_dir
        label_dir = explicit_label_dir or (labels_child if labels_child.is_dir() else None)
        return image_dir, label_dir, parent_dir

    if explicit_image_dir is None:
        raise HTTPException(status_code=400, detail="Enter either a parent folder or an image folder")
    return explicit_image_dir, explicit_label_dir, None


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
            )
        )
        report.imported_annotations += 1


def media_to_read(item: models.MediaItem) -> MediaRead:
    return MediaRead(
        id=item.id,
        dataset_id=item.dataset_id,
        file_name=item.file_name,
        image_url=f"/storage/{item.storage_key}",
        width=item.width or 1,
        height=item.height or 1,
        frame_index=item.frame_index,
        timestamp_seconds=item.timestamp_seconds,
        created_at=item.created_at,
    )


def import_session_to_read(session: models.ImportSession) -> ImportSessionRead:
    return ImportSessionRead(
        id=session.id,
        dataset_id=session.dataset_id,
        parent_dir=session.parent_dir,
        image_dir=session.image_dir,
        label_dir=session.label_dir,
        task=session.task,
        duplicate_policy=session.duplicate_policy,
        imported_images=session.imported_images,
        imported_annotations=session.imported_annotations,
        skipped_images=session.skipped_images,
        issue_count=session.issue_count,
        created_at=session.created_at,
    )
