from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models
from app.db.session import get_db
from app.domain.schemas import VideoROICreate, VideoROIRead

router = APIRouter()


@router.get("/{dataset_id}/roi/{video_name}", response_model=VideoROIRead)
def get_video_roi(
    dataset_id: UUID,
    video_name: str,
    db: Session = Depends(get_db),
) -> VideoROIRead:
    roi = db.scalar(
        select(models.VideoROI).where(
            models.VideoROI.dataset_id == dataset_id,
            models.VideoROI.video_name == video_name,
        )
    )
    if not roi:
        raise HTTPException(status_code=404, detail="ROI not found for this video")
    return roi


@router.put("/{dataset_id}/roi/{video_name}", response_model=VideoROIRead)
def set_video_roi(
    dataset_id: UUID,
    video_name: str,
    payload: VideoROICreate,
    db: Session = Depends(get_db),
) -> VideoROIRead:
    roi = db.scalar(
        select(models.VideoROI).where(
            models.VideoROI.dataset_id == dataset_id,
            models.VideoROI.video_name == video_name,
        )
    )
    
    polygon_dicts = [{"x": p.x, "y": p.y} for p in payload.polygon]

    if roi:
        roi.polygon = polygon_dicts
    else:
        roi = models.VideoROI(
            dataset_id=dataset_id,
            video_name=video_name,
            polygon=polygon_dicts,
        )
        db.add(roi)

    db.commit()
    db.refresh(roi)
    return roi
