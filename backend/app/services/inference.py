from dataclasses import dataclass
from pathlib import Path

from app.domain.classes import AnnotationTask
from app.domain.schemas import AnnotationCreate, AnnotationSource, AnnotationStatus, Box


@dataclass(frozen=True)
class Detection:
    task: AnnotationTask
    class_id: int
    confidence: float
    box: Box


class YoloInferenceService:
    def __init__(self, vehicle_model_path: Path, plate_model_path: Path) -> None:
        self.vehicle_model_path = vehicle_model_path
        self.plate_model_path = plate_model_path

    def detect(self, image_path: Path) -> list[Detection]:
        """Run vehicle and plate models for one image.

        This placeholder keeps route and worker code independent from the
        concrete Ultralytics API. Loading models lazily in this class avoids
        paying GPU startup cost during normal API requests.
        """
        _ = image_path
        return []


def detection_to_annotation(media_id, detection: Detection) -> AnnotationCreate:
    return AnnotationCreate(
        media_id=media_id,
        task=detection.task,
        class_id=detection.class_id,
        box=detection.box,
        confidence=detection.confidence,
        source=AnnotationSource.MODEL,
        status=AnnotationStatus.DRAFT,
    )
