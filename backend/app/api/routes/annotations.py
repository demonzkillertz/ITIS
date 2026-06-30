from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_db
from app.domain.classes import class_map_for_task
from app.domain.schemas import AnnotationCreate, AnnotationRead, CopyClassRequest

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
            is_prefetched=annotation.is_prefetched,
            reviewed_by_user=annotation.reviewed_by_user,
            verified_at=annotation.verified_at,
            polygon=[{"x": p.x, "y": p.y} for p in annotation.polygon] if annotation.polygon else None,
            updated_at=datetime.utcnow(),
        )
        db.add(saved_annotation)
        saved.append(saved_annotation)

    db.commit()
    for annotation in saved:
        db.refresh(annotation)
    return [annotation_to_read(annotation) for annotation in saved]


@router.post("/copy-class", response_model=dict[str, int])
def copy_class_annotations(
    payload: CopyClassRequest,
    db: Session = Depends(get_db),
) -> dict[str, int]:
    source_media = ensure_media(db, payload.source_media_id)
    
    source_annotations = db.scalars(
        select(models.Annotation)
        .where(
            models.Annotation.media_id == source_media.id,
            models.Annotation.class_id == payload.class_id
        )
    ).all()

    if not source_annotations:
        return {"copied_to": 0}

    target_media_items = db.scalars(
        select(models.MediaItem).where(models.MediaItem.id.in_(payload.target_media_ids))
    ).all()
    
    copied_count = 0
    for target in target_media_items:
        # Delete existing annotations of the same class
        db.execute(
            delete(models.Annotation).where(
                models.Annotation.media_id == target.id,
                models.Annotation.class_id == payload.class_id
            )
        )
        
        # Copy annotations
        for src_ann in source_annotations:
            new_ann = models.Annotation(
                media_id=target.id,
                task=src_ann.task,
                class_id=src_ann.class_id,
                x_center=src_ann.x_center,
                y_center=src_ann.y_center,
                width=src_ann.width,
                height=src_ann.height,
                confidence=src_ann.confidence,
                source=src_ann.source,
                status=src_ann.status,
                is_prefetched=src_ann.is_prefetched,
                reviewed_by_user=src_ann.reviewed_by_user,
                verified_at=src_ann.verified_at,
                polygon=src_ann.polygon,
                updated_at=datetime.utcnow()
            )
            db.add(new_ann)
        copied_count += 1
        
    db.commit()
    return {"copied_to": copied_count}


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
        is_prefetched=annotation.is_prefetched,
        reviewed_by_user=annotation.reviewed_by_user,
        verified_at=annotation.verified_at,
        polygon=[{"x": p["x"], "y": p["y"]} for p in annotation.polygon] if annotation.polygon else None,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )
