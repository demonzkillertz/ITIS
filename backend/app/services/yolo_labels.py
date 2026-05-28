from dataclasses import dataclass

from app.domain.classes import AnnotationTask, class_map_for_task
from app.domain.schemas import Box


@dataclass(frozen=True)
class ParsedYoloLabel:
    class_id: int
    box: Box


class YoloLabelError(ValueError):
    pass


def parse_yolo_row(row: str, task: AnnotationTask) -> ParsedYoloLabel:
    parts = row.split()
    if len(parts) != 5:
        raise YoloLabelError("YOLO row must contain exactly 5 fields")

    try:
        class_id = int(parts[0])
        x_center, y_center, width, height = (float(value) for value in parts[1:])
    except ValueError as exc:
        raise YoloLabelError("YOLO row contains non-numeric values") from exc

    if class_id not in class_map_for_task(task):
        raise YoloLabelError(f"class_id {class_id} is not valid for task {task}")

    try:
        box = Box(x_center=x_center, y_center=y_center, width=width, height=height)
    except ValueError as exc:
        raise YoloLabelError("YOLO box coordinates are outside normalized bounds") from exc

    return ParsedYoloLabel(class_id=class_id, box=box)


def serialize_yolo_label(label: ParsedYoloLabel) -> str:
    box = label.box
    return (
        f"{label.class_id} "
        f"{box.x_center:.6f} {box.y_center:.6f} {box.width:.6f} {box.height:.6f}"
    )


def parse_label_file(text: str, task: AnnotationTask) -> list[ParsedYoloLabel]:
    labels: list[ParsedYoloLabel] = []
    for line_number, row in enumerate(text.splitlines(), start=1):
        row = row.strip()
        if not row:
            continue
        try:
            labels.append(parse_yolo_row(row, task))
        except YoloLabelError as exc:
            raise YoloLabelError(f"line {line_number}: {exc}") from exc
    return labels
