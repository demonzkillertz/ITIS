from fastapi import APIRouter, HTTPException

from app.domain.schemas import ModelCatalogRead, ModelDownloadCreate, ProcessingJobRead
from app.services.model_registry import (
    BASE_MODEL_DEFINITIONS,
    ensure_base_model,
    model_catalog,
)

router = APIRouter()


@router.get("", response_model=ModelCatalogRead)
def list_yolo_models() -> ModelCatalogRead:
    return ModelCatalogRead(
        vehicle_default="custom_vehicle",
        plate_default="custom_plate",
        models=model_catalog(),
    )


@router.post("/download", response_model=ProcessingJobRead)
def download_yolo_models(payload: ModelDownloadCreate) -> ProcessingJobRead:
    keys = payload.keys or list(BASE_MODEL_DEFINITIONS.keys())
    downloaded: list[str] = []
    for key in keys:
        if key not in BASE_MODEL_DEFINITIONS:
            raise HTTPException(status_code=400, detail=f"Unknown downloadable model: {key}")
        try:
            ensure_base_model(key)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Could not download {key}: {exc}") from exc
        downloaded.append(key)

    return ProcessingJobRead(
        kind="model_download",
        status="completed",
        message=f"Ready models: {', '.join(downloaded)}",
    )

