r"""Extract useful high-quality vehicle frames from a video using YOLOv9c.

Example:
    python ext.py --video C:\videos\traffic.mp4 --output C:\datasets\traffic_extract --fps 2

Outputs:
    output/
      images/
        video_frame_000001_0000000000ms.jpg
      labels/
        video_frame_000001_0000000000ms.txt

The label classes match the ITIS vehicle dataset:
    1 bike
    2 car
    3 bus_microbus
    4 large_vehicle
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2


COCO_TO_ITIS_VEHICLE = {
    1: 1,  # bicycle -> bike
    3: 1,  # motorcycle -> bike
    2: 2,  # car -> car
    5: 3,  # bus -> bus_microbus
    7: 4,  # truck -> large_vehicle
}


@dataclass(frozen=True)
class VehicleBox:
    class_id: int
    confidence: float
    x_center: float
    y_center: float
    width: float
    height: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract non-duplicate vehicle frames from a video.")
    parser.add_argument("--video", type=Path, required=True, help="Input video path")
    parser.add_argument("--output", type=Path, required=True, help="Output folder")
    parser.add_argument("--model", default="yolov9c.pt", help="YOLO model path/name. Default downloads/uses YOLOv9 compact.")
    parser.add_argument("--fps", type=float, default=2.0, help="How many frames per second to analyze")
    parser.add_argument("--conf", type=float, default=0.35, help="YOLO confidence threshold")
    parser.add_argument("--imgsz", type=int, default=960, help="YOLO inference image size")
    parser.add_argument("--batch", type=int, default=16, help="YOLO batch size")
    parser.add_argument("--quality", type=int, default=95, help="JPEG quality, 1-100")
    parser.add_argument("--duplicate-iou", type=float, default=0.72, help="IoU threshold used for duplicate vehicle layouts")
    parser.add_argument("--history", type=int, default=3, help="Compare against this many recently saved frames")
    parser.add_argument("--keep-empty", action="store_true", help="Save frames even when no vehicles are detected")
    parser.add_argument("--device", default=None, help="YOLO device, e.g. cuda:0 or cpu. Auto-selects CUDA when available.")
    return parser.parse_args()


def default_device() -> str | None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.backends.cudnn.benchmark = True
            return "cuda:0"
    except Exception:
        return None
    return None


def load_model(model_name: str):
    from ultralytics import YOLO

    return YOLO(model_name)


def safe_name(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "_" for char in value).strip("._")
    return cleaned or "video"


def box_to_corners(box: VehicleBox) -> tuple[float, float, float, float]:
    return (
        box.x_center - box.width / 2,
        box.y_center - box.height / 2,
        box.x_center + box.width / 2,
        box.y_center + box.height / 2,
    )


def iou(first: VehicleBox, second: VehicleBox) -> float:
    first_x1, first_y1, first_x2, first_y2 = box_to_corners(first)
    second_x1, second_y1, second_x2, second_y2 = box_to_corners(second)
    intersection_width = max(0.0, min(first_x2, second_x2) - max(first_x1, second_x1))
    intersection_height = max(0.0, min(first_y2, second_y2) - max(first_y1, second_y1))
    intersection = intersection_width * intersection_height
    first_area = max(0.0, first_x2 - first_x1) * max(0.0, first_y2 - first_y1)
    second_area = max(0.0, second_x2 - second_x1) * max(0.0, second_y2 - second_y1)
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def is_duplicate_layout(
    detections: list[VehicleBox],
    previous_layouts: Iterable[list[VehicleBox]],
    duplicate_iou: float,
) -> bool:
    if not detections:
        return False

    current = sorted(detections, key=lambda box: (box.class_id, box.x_center, box.y_center))
    for previous in previous_layouts:
        if len(current) != len(previous):
            continue
        previous_sorted = sorted(previous, key=lambda box: (box.class_id, box.x_center, box.y_center))
        matched_previous: set[int] = set()
        all_matched = True
        for box in current:
            best_index = None
            best_iou = 0.0
            for index, previous_box in enumerate(previous_sorted):
                if index in matched_previous or previous_box.class_id != box.class_id:
                    continue
                overlap = iou(box, previous_box)
                if overlap > best_iou:
                    best_iou = overlap
                    best_index = index
            if best_index is None or best_iou < duplicate_iou:
                all_matched = False
                break
            matched_previous.add(best_index)
        if all_matched:
            return True
    return False


def detections_from_result(result) -> list[VehicleBox]:
    image_height, image_width = result.orig_shape[:2]
    detections: list[VehicleBox] = []
    for box in result.boxes:
        raw_class_id = int(box.cls.item())
        class_id = COCO_TO_ITIS_VEHICLE.get(raw_class_id)
        if class_id is None:
            continue

        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        width = max(0.0, x2 - x1)
        height = max(0.0, y2 - y1)
        if width <= 0 or height <= 0:
            continue

        detections.append(
            VehicleBox(
                class_id=class_id,
                confidence=float(box.conf.item()),
                x_center=(x1 + width / 2) / float(image_width),
                y_center=(y1 + height / 2) / float(image_height),
                width=width / float(image_width),
                height=height / float(image_height),
            )
        )
    return detections


def write_labels(path: Path, detections: list[VehicleBox]) -> None:
    rows = [
        f"{box.class_id} {box.x_center:.6f} {box.y_center:.6f} {box.width:.6f} {box.height:.6f}"
        for box in detections
    ]
    path.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")


def save_frame(
    frame,
    images_dir: Path,
    labels_dir: Path,
    base: str,
    saved_count: int,
    timestamp_ms: int,
    detections: list[VehicleBox],
    quality: int,
) -> None:
    stem = f"{base}_frame_{saved_count:06d}_{timestamp_ms:010d}ms"
    image_path = images_dir / f"{stem}.jpg"
    label_path = labels_dir / f"{stem}.txt"
    cv2.imwrite(str(image_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), max(1, min(100, quality))])
    write_labels(label_path, detections)


def main() -> None:
    args = parse_args()
    if not args.video.exists():
        raise FileNotFoundError(f"Video not found: {args.video}")

    images_dir = args.output / "images"
    labels_dir = args.output / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    model = load_model(args.model)
    device = args.device or default_device()

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {args.video}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 25)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(source_fps / max(args.fps, 0.001))))
    base = safe_name(args.video.stem)

    frame_number = 0
    inspected_count = 0
    saved_count = 0
    skipped_empty = 0
    skipped_duplicate = 0
    recent_layouts: list[list[VehicleBox]] = []
    pending: list[tuple[int, object]] = []

    def flush_pending() -> None:
        nonlocal saved_count, skipped_empty, skipped_duplicate, recent_layouts
        if not pending:
            return

        frames = [item[1] for item in pending]
        results = model.predict(
            frames,
            conf=args.conf,
            imgsz=args.imgsz,
            device=device,
            half=device is not None and device != "cpu",
            batch=max(1, min(args.batch, len(frames))),
            verbose=False,
        )

        for (sampled_frame_number, frame), result in zip(pending, results):
            detections = detections_from_result(result)
            if not detections and not args.keep_empty:
                skipped_empty += 1
                continue
            if is_duplicate_layout(detections, reversed(recent_layouts), args.duplicate_iou):
                skipped_duplicate += 1
                continue

            timestamp_ms = int((sampled_frame_number / source_fps) * 1000) if source_fps else 0
            saved_count += 1
            save_frame(frame, images_dir, labels_dir, base, saved_count, timestamp_ms, detections, args.quality)
            if detections:
                recent_layouts.append(detections)
                recent_layouts = recent_layouts[-max(1, args.history) :]

        pending.clear()

    try:
        while total_frames <= 0 or frame_number < total_frames:
            ok, frame = capture.read()
            if not ok:
                break

            pending.append((frame_number, frame))
            inspected_count += 1
            frame_number += 1

            skipped = 0
            while skipped < step - 1 and (total_frames <= 0 or frame_number < total_frames):
                if not capture.grab():
                    break
                frame_number += 1
                skipped += 1

            if len(pending) >= max(1, args.batch):
                flush_pending()

        flush_pending()
    finally:
        capture.release()

    print(f"Device: {device or 'cpu'}")
    print(f"Source FPS: {source_fps:.2f}")
    print(f"Analysis FPS: {args.fps}")
    print(f"Inspected frames: {inspected_count}")
    print(f"Saved frames: {saved_count}")
    print(f"Skipped empty: {skipped_empty}")
    print(f"Skipped duplicate vehicle layouts: {skipped_duplicate}")
    print(f"Images: {images_dir}")
    print(f"Labels: {labels_dir}")


if __name__ == "__main__":
    main()
