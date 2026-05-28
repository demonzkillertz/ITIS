from pathlib import Path
from shutil import copy2

from app.core.config import settings
from app.domain.classes import AnnotationTask
from app.domain.schemas import ModelOptionRead


BASE_MODEL_DEFINITIONS = {
    "yolov8n": ("YOLOv8 nano", "yolov8", "yolov8n.pt"),
    "yolov9c": ("YOLOv9 compact", "yolov9", "yolov9c.pt"),
    "yolo11n": ("YOLO11 nano", "yolo11", "yolo11n.pt"),
}

CUSTOM_MODEL_DEFINITIONS = {
    "custom_vehicle": ("Kept vehicle model", AnnotationTask.VEHICLE, "custom", "vehicle.pt"),
    "custom_plate": ("Kept number plate model", AnnotationTask.PLATE, "custom", "plate.pt"),
}


def base_model_root() -> Path:
    return settings.storage_root / "models" / "base"


def model_catalog() -> list[ModelOptionRead]:
    models: list[ModelOptionRead] = []
    custom_paths = {
        "custom_vehicle": settings.vehicle_model_path,
        "custom_plate": settings.plate_model_path,
    }
    for key, (label, task, family, file_name) in CUSTOM_MODEL_DEFINITIONS.items():
        path = custom_paths[key]
        models.append(
            ModelOptionRead(
                key=key,
                label=label,
                task=task,
                family=family,
                file_name=file_name,
                path=str(path),
                is_custom=True,
                is_downloaded=path.exists(),
            )
        )

    for key, (label, family, file_name) in BASE_MODEL_DEFINITIONS.items():
        path = base_model_root() / file_name
        models.append(
            ModelOptionRead(
                key=key,
                label=label,
                task=None,
                family=family,
                file_name=file_name,
                path=str(path),
                is_downloaded=path.exists(),
            )
        )
    return models


def model_path_for_key(key: str | None, task: AnnotationTask) -> Path:
    selected = key or ("custom_vehicle" if task == AnnotationTask.VEHICLE else "custom_plate")
    if selected == "custom_vehicle":
        return settings.vehicle_model_path
    if selected == "custom_plate":
        return settings.plate_model_path
    if selected in BASE_MODEL_DEFINITIONS:
        return ensure_base_model(selected)
    return settings.vehicle_model_path if task == AnnotationTask.VEHICLE else settings.plate_model_path


def ensure_base_model(key: str) -> Path:
    if key not in BASE_MODEL_DEFINITIONS:
        raise ValueError(f"Unknown model key: {key}")

    _label, _family, file_name = BASE_MODEL_DEFINITIONS[key]
    target = base_model_root() / file_name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return target

    from ultralytics import YOLO

    model = YOLO(file_name)
    candidates = [
        Path(getattr(model, "ckpt_path", "")),
        Path.cwd() / file_name,
        Path.home() / ".cache" / "ultralytics" / file_name,
    ]
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            if candidate.resolve() == target.resolve():
                return target
            copy2(candidate, target)
            if candidate.parent.resolve() == Path.cwd().resolve():
                candidate.unlink(missing_ok=True)
            return target

    raise FileNotFoundError(f"Ultralytics downloaded {file_name}, but the file could not be located.")


def is_base_model_key(key: str | None) -> bool:
    return bool(key and key in BASE_MODEL_DEFINITIONS)
