"""Extract video frames and matching YOLO labels for the ITIS annotator.

Output layout:
  output_dir/
    images/
      video_frame_000001_0000000000ms.jpg
    labels/
      video_frame_000001_0000000000ms.txt

The label files use the same YOLO normalized format imported by the app:
  class_id x_center y_center width height
"""

from __future__ import annotations

import argparse
import re
import tomllib
from functools import lru_cache
from pathlib import Path

import cv2


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract frames and YOLO labels from a video.")
    parser.add_argument("--config", type=Path, default=Path("tools/video_frame_yolo_extract.conf"))
    parser.add_argument("--video", type=Path, default=None, help="Input video path")
    parser.add_argument("--output", type=Path, default=None, help="Output dataset folder")
    parser.add_argument("--model", type=Path, default=None, help="Optional YOLO .pt model path")
    parser.add_argument("--task", choices=["vehicle", "plate"], default=None)
    parser.add_argument("--fps", type=float, default=None, help="How many frames per second to inspect")
    parser.add_argument("--conf", type=float, default=None, help="YOLO confidence threshold")
    parser.add_argument("--imgsz", type=int, default=None, help="YOLO inference image size")
    parser.add_argument("--device", default=None, help="YOLO device, for example cuda:0 or cpu")
    parser.add_argument("--batch", type=int, default=None, help="YOLO batch size for sampled frames")
    parser.add_argument("--base-coco", action="store_true", default=None, help="Map COCO vehicle classes to ITIS vehicle classes")
    parser.add_argument("--keep-empty", action="store_true", default=None, help="Keep frames even when no labels are detected")
    parser.add_argument("--min-change", type=float, default=None, help="Mean pixel diff needed to keep a near-duplicate frame")
    parser.add_argument("--jpg-quality", type=int, default=None)
    return merge_config(parser.parse_args())


def merge_config(args: argparse.Namespace) -> argparse.Namespace:
    config = load_config(args.config)
    defaults = {
        "video": None,
        "output": None,
        "model": None,
        "task": "plate",
        "fps": 2.0,
        "conf": 0.25,
        "imgsz": 640,
        "device": None,
        "batch": 16,
        "base_coco": False,
        "keep_empty": False,
        "min_change": 6.0,
        "jpg_quality": 92,
    }
    merged = {**defaults, **config}
    for key in defaults:
        value = getattr(args, key, None)
        if value is not None:
            merged[key] = value

    if merged["video"] is None:
        raise ValueError("Set video in the config file or pass --video")
    if merged["output"] is None:
        raise ValueError("Set output in the config file or pass --output")
    if merged["task"] not in {"vehicle", "plate"}:
        raise ValueError("task must be vehicle or plate")

    for key in ("video", "output", "model"):
        if merged[key] is not None:
            if key == "model" and str(merged[key]).strip() == "":
                merged[key] = None
                continue
            merged[key] = Path(merged[key])
    if merged["device"] == "":
        merged["device"] = None
    return argparse.Namespace(**merged)


def load_config(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    with path.open("rb") as config_file:
        raw = tomllib.load(config_file)
    return raw.get("extract", raw)


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return cleaned or "video"


def map_class(raw_class_id: int, task: str, base_coco: bool) -> int | None:
    if task == "plate":
        return 0 if raw_class_id == 0 else None

    if base_coco:
        coco_to_itis = {
            1: 1,  # bicycle -> bike
            3: 1,  # motorcycle -> bike
            2: 2,  # car
            5: 3,  # bus
            7: 4,  # truck
        }
        return coco_to_itis.get(raw_class_id)

    return raw_class_id if raw_class_id in {1, 2, 3, 4} else None


def frame_changed(previous_gray, frame, min_change: float) -> tuple[bool, object]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (160, 90), interpolation=cv2.INTER_AREA)
    if previous_gray is None:
        return True, gray
    diff = cv2.absdiff(previous_gray, gray)
    return float(diff.mean()) >= min_change, gray


def default_device() -> str | None:
    try:
        import torch

        if torch.cuda.is_available():
            torch.backends.cudnn.benchmark = True
            return "cuda:0"
    except Exception:
        return None
    return None


@lru_cache(maxsize=4)
def load_model_cached(model_path: str):
    from ultralytics import YOLO

    model = YOLO(model_path)
    device = default_device()
    if device:
        try:
            model.to(device)
        except Exception:
            pass
    return model


def load_model(model_path: Path | None):
    if model_path is None:
        return None
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")
    return load_model_cached(str(model_path))


def predict_labels(model, frame, task: str, base_coco: bool, conf: float, imgsz: int, device: str | None) -> list[str]:
    if model is None:
        return []

    results = model.predict(frame, conf=conf, imgsz=imgsz, device=device or default_device(), half=bool(device or default_device()), verbose=False)
    rows: list[str] = []
    for result in results:
        image_height, image_width = result.orig_shape[:2]
        for box in result.boxes:
            class_id = map_class(int(box.cls.item()), task, base_coco)
            if class_id is None:
                continue
            x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)
            if width <= 0 or height <= 0:
                continue
            x_center = (x1 + width / 2) / float(image_width)
            y_center = (y1 + height / 2) / float(image_height)
            rows.append(
                f"{class_id} {x_center:.6f} {y_center:.6f} "
                f"{width / float(image_width):.6f} {height / float(image_height):.6f}"
            )
    return rows


def predict_label_batches(model, frames, task: str, base_coco: bool, conf: float, imgsz: int, device: str | None) -> list[list[str]]:
    if model is None:
        return [[] for _frame in frames]
    actual_device = device or default_device()
    results = model.predict(
        frames,
        conf=conf,
        imgsz=imgsz,
        device=actual_device,
        half=actual_device is not None,
        batch=max(1, len(frames)),
        verbose=False,
    )
    return [labels_from_result(result, task, base_coco) for result in results]


def labels_from_result(result, task: str, base_coco: bool) -> list[str]:
    rows: list[str] = []
    image_height, image_width = result.orig_shape[:2]
    for box in result.boxes:
        class_id = map_class(int(box.cls.item()), task, base_coco)
        if class_id is None:
            continue
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        width = max(0.0, x2 - x1)
        height = max(0.0, y2 - y1)
        if width <= 0 or height <= 0:
            continue
        x_center = (x1 + width / 2) / float(image_width)
        y_center = (y1 + height / 2) / float(image_height)
        rows.append(
            f"{class_id} {x_center:.6f} {y_center:.6f} "
            f"{width / float(image_width):.6f} {height / float(image_height):.6f}"
        )
    return rows


def main() -> None:
    args = parse_args()
    if not args.video.exists():
        raise FileNotFoundError(f"Video not found: {args.video}")
    if args.video.suffix.lower() in IMAGE_EXTENSIONS:
        raise ValueError("Expected a video file, got an image path")

    images_dir = args.output / "images"
    labels_dir = args.output / "labels"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    model = load_model(args.model)
    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {args.video}")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or 25)
    step = max(1, int(round(source_fps / max(args.fps, 0.001))))
    base = safe_name(args.video.stem)
    frame_number = 0
    saved_count = 0
    skipped_empty = 0
    skipped_duplicate = 0
    previous_gray = None
    pending: list[tuple[int, object, object]] = []

    def save_pending() -> None:
        nonlocal saved_count, skipped_empty, previous_gray
        if not pending:
            return
        frames = [item[1] for item in pending]
        label_batches = predict_label_batches(
            model=model,
            frames=frames,
            task=args.task,
            base_coco=args.base_coco,
            conf=args.conf,
            imgsz=args.imgsz,
            device=args.device,
        )
        for (pending_frame_number, pending_frame, next_gray), labels in zip(pending, label_batches):
            if not labels and not args.keep_empty:
                skipped_empty += 1
                previous_gray = next_gray
                continue

            timestamp_ms = int((pending_frame_number / source_fps) * 1000) if source_fps else 0
            saved_count += 1
            stem = f"{base}_frame_{saved_count:06d}_{timestamp_ms:010d}ms"
            image_path = images_dir / f"{stem}.jpg"
            label_path = labels_dir / f"{stem}.txt"

            cv2.imwrite(str(image_path), pending_frame, [int(cv2.IMWRITE_JPEG_QUALITY), args.jpg_quality])
            label_path.write_text("\n".join(labels) + ("\n" if labels else ""), encoding="utf-8")
            previous_gray = next_gray
        pending.clear()

    try:
        while True:
            if step > 1:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ok, frame = capture.read()
            if not ok:
                break

            changed, next_gray = frame_changed(previous_gray, frame, args.min_change)
            if not changed:
                skipped_duplicate += 1
                frame_number += step
                continue

            pending.append((frame_number, frame, next_gray))
            if len(pending) >= max(1, args.batch):
                save_pending()
            frame_number += step
        save_pending()
    finally:
        capture.release()

    print(f"Saved frames: {saved_count}")
    print(f"Images: {images_dir}")
    print(f"Labels: {labels_dir}")
    print(f"Skipped empty: {skipped_empty}")
    print(f"Skipped near-duplicate: {skipped_duplicate}")


if __name__ == "__main__":
    main()
