from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_db
from app.domain.classes import class_map_for_task
from app.domain.schemas import AnnotationCreate, AnnotationRead

router = APIRouter()


@router.get("/{media_id}", response_model=list[AnnotationRead])
def list_annotations(media_id: UUID, db: Session = Depends(get_db)) -> list[AnnotationRead]:
    ensure_media(db, media_id)
    annotations = db.scalars(
        select(models.Annotation)
        .where(models.Annotation.media_id == media_id)
        .order_by(models.Annotation.created_at.asc())
    ).all()
    return [annotation_to_read(annotation) for annotation in annotations]


@router.put("/{media_id}", response_model=list[AnnotationRead])
def replace_annotations(
    media_id: UUID,
    annotations: list[AnnotationCreate],
    db: Session = Depends(get_db),
) -> list[AnnotationRead]:
    ensure_media(db, media_id)
    db.execute(delete(models.Annotation).where(models.Annotation.media_id == media_id))
    saved: list[models.Annotation] = []

    for annotation in annotations:
        if annotation.media_id != media_id:
            raise HTTPException(status_code=400, detail="Annotation media_id does not match URL")
        if annotation.class_id not in class_map_for_task(annotation.task):
            raise HTTPException(status_code=400, detail="Invalid class for annotation task")

        saved_annotation = models.Annotation(
            media_id=media_id,
            task=annotation.task,
            class_id=annotation.class_id,
            x_center=annotation.box.x_center,
            y_center=annotation.box.y_center,
            width=annotation.box.width,
            height=annotation.box.height,
            confidence=annotation.confidence,
            source=annotation.source,
            status=annotation.status,
            updated_at=datetime.utcnow(),
        )
        db.add(saved_annotation)
        saved.append(saved_annotation)

    db.commit()
    for annotation in saved:
        db.refresh(annotation)
    return [annotation_to_read(annotation) for annotation in saved]


def ensure_media(db: Session, media_id: UUID) -> models.MediaItem:
    media = db.get(models.MediaItem, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Media item not found")
    return media


def annotation_to_read(annotation: models.Annotation) -> AnnotationRead:
    return AnnotationRead(
        id=annotation.id,
        media_id=annotation.media_id,
        task=annotation.task,
        class_id=annotation.class_id,
        box={
            "x_center": annotation.x_center,
            "y_center": annotation.y_center,
            "width": annotation.width,
            "height": annotation.height,
        },
        confidence=annotation.confidence,
        source=annotation.source,
        status=annotation.status,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )
