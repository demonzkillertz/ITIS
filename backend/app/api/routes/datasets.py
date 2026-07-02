from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from pydantic import BaseModel as PydanticBaseModel
from app.db import models
from app.db.session import get_db
from app.domain.classes import AnnotationTask, class_map_for_task
from app.domain.schemas import AnnotationStatus, DatasetCreate, DatasetRead, ImportReport, MediaType, ProcessingJobRead

router = APIRouter()


@router.post("", response_model=DatasetRead)
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)) -> DatasetRead:
    dataset = models.Dataset(name=payload.name, description=payload.description)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset_to_read(dataset, image_count=0, labeled_count=0, completed_count=0, completed_class_counts={})


@router.get("", response_model=list[DatasetRead])
def list_datasets(db: Session = Depends(get_db)) -> list[DatasetRead]:
    datasets = db.scalars(select(models.Dataset).order_by(models.Dataset.created_at.desc())).all()
    return [dataset_to_read(dataset, *dataset_counts(db, dataset.id)) for dataset in datasets]


@router.post("/{dataset_id}/import", response_model=ProcessingJobRead)
async def import_dataset_archive(
    dataset_id: UUID,
    archive: UploadFile,
    task: AnnotationTask = AnnotationTask.VEHICLE,
) -> ProcessingJobRead:
    _ = (dataset_id, archive, task)
    return ProcessingJobRead(kind="dataset_import", message="Import queued")


@router.get("/{dataset_id}/import-report", response_model=ImportReport)
def get_latest_import_report(dataset_id: UUID) -> ImportReport:
    _ = dataset_id
    return ImportReport()


def dataset_counts(db: Session, dataset_id: UUID) -> tuple[int, int, int, dict[str, int]]:
    image_count = db.scalar(
        select(func.count(models.MediaItem.id)).where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.media_type == "image",
        )
    )
    labeled_count = db.scalar(
        select(func.count(func.distinct(models.Annotation.media_id)))
        .join(models.MediaItem, models.MediaItem.id == models.Annotation.media_id)
        .where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.media_type == "image",
        )
    )
    completed_media = (
        select(
            models.Annotation.media_id.label("media_id"),
            func.sum(case((models.Annotation.status == AnnotationStatus.ACCEPTED, 1), else_=0)).label("accepted_count"),
            func.sum(case((models.Annotation.status != AnnotationStatus.ACCEPTED, 1), else_=0)).label("open_count"),
        )
        .join(models.MediaItem, models.MediaItem.id == models.Annotation.media_id)
        .where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.media_type == "image",
        )
        .group_by(models.Annotation.media_id)
        .subquery()
    )
    completed_count = db.scalar(
        select(func.count()).select_from(completed_media).where(
            completed_media.c.accepted_count > 0,
            completed_media.c.open_count == 0,
        )
    )
    class_counts_query = (
        select(models.Annotation.task, models.Annotation.class_id, func.count())
        .join(models.MediaItem, models.MediaItem.id == models.Annotation.media_id)
        .where(
            models.MediaItem.dataset_id == dataset_id,
            models.Annotation.status == AnnotationStatus.ACCEPTED,
        )
        .group_by(models.Annotation.task, models.Annotation.class_id)
    )
    class_counts_result = db.execute(class_counts_query).all()

    completed_class_counts: dict[str, int] = {}
    for task, class_id, count in class_counts_result:
        class_map = class_map_for_task(task)
        class_name = class_map.get(class_id, f"class_{class_id}")
        completed_class_counts[class_name] = completed_class_counts.get(class_name, 0) + count

    return int(image_count or 0), int(labeled_count or 0), int(completed_count or 0), completed_class_counts


def dataset_to_read(dataset: models.Dataset, image_count: int, labeled_count: int, completed_count: int, completed_class_counts: dict[str, int]) -> DatasetRead:
    return DatasetRead(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        created_at=dataset.created_at,
        image_count=image_count,
        labeled_count=labeled_count,
        completed_count=completed_count,
        completed_class_counts=completed_class_counts,
    )


class PendingImagesRead(PydanticBaseModel):
    total: int
    pending_count: int
    pending_indices: list[int]


@router.get("/{dataset_id}/pending-images", response_model=PendingImagesRead)
def get_pending_images(dataset_id: UUID, db: Session = Depends(get_db)) -> PendingImagesRead:
    """Return 1-indexed serial numbers of images that are NOT fully annotated."""
    # Get all image media items in order (same order as the frontend list)
    all_images = db.scalars(
        select(models.MediaItem)
        .where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.media_type == MediaType.IMAGE.value,
        )
        .order_by(models.MediaItem.created_at.asc())
    ).all()

    # Get the set of completed media IDs (all annotations accepted, at least one exists)
    completed_sub = (
        select(
            models.Annotation.media_id.label("media_id"),
            func.sum(case((models.Annotation.status == AnnotationStatus.ACCEPTED, 1), else_=0)).label("accepted"),
            func.sum(case((models.Annotation.status != AnnotationStatus.ACCEPTED, 1), else_=0)).label("open"),
        )
        .join(models.MediaItem, models.MediaItem.id == models.Annotation.media_id)
        .where(
            models.MediaItem.dataset_id == dataset_id,
            models.MediaItem.media_type == MediaType.IMAGE.value,
        )
        .group_by(models.Annotation.media_id)
        .subquery()
    )
    completed_ids_result = db.execute(
        select(completed_sub.c.media_id).where(
            completed_sub.c.accepted > 0,
            completed_sub.c.open == 0,
        )
    ).all()
    completed_ids = {row[0] for row in completed_ids_result}

    # Build pending indices (1-indexed)
    pending_indices = []
    for idx, item in enumerate(all_images):
        if item.id not in completed_ids:
            pending_indices.append(idx + 1)  # 1-indexed

    return PendingImagesRead(
        total=len(all_images),
        pending_count=len(pending_indices),
        pending_indices=pending_indices,
    )
