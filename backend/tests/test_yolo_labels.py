import pytest

from app.domain.classes import AnnotationTask
from app.services.yolo_labels import YoloLabelError, parse_yolo_row, serialize_yolo_label


def test_parse_valid_vehicle_label() -> None:
    label = parse_yolo_row("1 0.500000 0.400000 0.250000 0.300000", AnnotationTask.VEHICLE)

    assert label.class_id == 1
    assert label.box.x_center == 0.5
    assert serialize_yolo_label(label) == "1 0.500000 0.400000 0.250000 0.300000"


def test_rejects_invalid_class_for_plate_task() -> None:
    with pytest.raises(YoloLabelError):
        parse_yolo_row("1 0.5 0.5 0.2 0.2", AnnotationTask.PLATE)


def test_rejects_out_of_bounds_coordinates() -> None:
    with pytest.raises(YoloLabelError):
        parse_yolo_row("0 1.2 0.5 0.2 0.2", AnnotationTask.VEHICLE)
