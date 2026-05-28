from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_db
from app.domain.classes import AnnotationTask
from app.domain.schemas import DatasetCreate, DatasetRead, ImportReport, ProcessingJobRead

router = APIRouter()


@router.post("", response_model=DatasetRead)
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)) -> DatasetRead:
    dataset = models.Dataset(name=payload.name, description=payload.description)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset_to_read(dataset, image_count=0, labeled_count=0)


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


def dataset_counts(db: Session, dataset_id: UUID) -> tuple[int, int]:
    image_count = db.scalar(
        select(func.count(models.MediaItem.id)).where(models.MediaItem.dataset_id == dataset_id)
    )
    labeled_count = db.scalar(
        select(func.count(func.distinct(models.Annotation.media_id)))
        .join(models.MediaItem, models.MediaItem.id == models.Annotation.media_id)
        .where(models.MediaItem.dataset_id == dataset_id)
    )
    return int(image_count or 0), int(labeled_count or 0)


def dataset_to_read(dataset: models.Dataset, image_count: int, labeled_count: int) -> DatasetRead:
    return DatasetRead(
        id=dataset.id,
        name=dataset.name,
        description=dataset.description,
        created_at=dataset.created_at,
        image_count=image_count,
        labeled_count=labeled_count,
    )
