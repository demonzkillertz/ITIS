from app.api.routes.media import box_iou, has_duplicate_annotation
from app.domain.classes import AnnotationTask


def test_detects_duplicate_box_with_high_overlap() -> None:
    existing = [
        {
            "task": AnnotationTask.VEHICLE,
            "class_id": 1,
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
        }
    ]
    candidate = {
        "task": AnnotationTask.VEHICLE,
        "class_id": 1,
        "x_center": 0.502,
        "y_center": 0.501,
        "width": 0.2,
        "height": 0.2,
    }

    assert has_duplicate_annotation(existing, candidate)


def test_allows_same_location_for_different_class() -> None:
    existing = [
        {
            "task": AnnotationTask.VEHICLE,
            "class_id": 1,
            "x_center": 0.5,
            "y_center": 0.5,
            "width": 0.2,
            "height": 0.2,
        }
    ]
    candidate = {
        "task": AnnotationTask.VEHICLE,
        "class_id": 2,
        "x_center": 0.5,
        "y_center": 0.5,
        "width": 0.2,
        "height": 0.2,
    }

    assert not has_duplicate_annotation(existing, candidate)


def test_iou_is_zero_for_separate_boxes() -> None:
    first = {"x_center": 0.2, "y_center": 0.2, "width": 0.1, "height": 0.1}
    second = {"x_center": 0.8, "y_center": 0.8, "width": 0.1, "height": 0.1}

    assert box_iou(first, second) == 0
