from enum import StrEnum


class AnnotationTask(StrEnum):
    VEHICLE = "vehicle"
    PLATE = "plate"


VEHICLE_CLASSES: dict[int, str] = {
    1: "bike",
    2: "car",
    3: "bus_microbus",
    4: "large_vehicle",
}

PLATE_CLASSES: dict[int, str] = {
    0: "number_plate",
}


def class_map_for_task(task: AnnotationTask) -> dict[int, str]:
    if task == AnnotationTask.VEHICLE:
        return VEHICLE_CLASSES
    return PLATE_CLASSES
