from pathlib import Path

from app.domain.classes import AnnotationTask
from app.domain.schemas import ImportIssue, ImportReport
from app.services.yolo_labels import YoloLabelError, parse_label_file

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def scan_yolo_dataset(root: Path, task: AnnotationTask) -> ImportReport:
    images_dir = root / "images"
    labels_dir = root / "labels"
    report = ImportReport()

    if not images_dir.exists():
        report.issues.append(
            ImportIssue(
                path=str(images_dir),
                issue_type="missing_images_dir",
                message="Dataset archive does not contain an images directory.",
            )
        )
        return report

    if not labels_dir.exists():
        report.issues.append(
            ImportIssue(
                path=str(labels_dir),
                issue_type="missing_labels_dir",
                message="Dataset archive does not contain a labels directory.",
            )
        )

    seen_names: set[str] = set()
    for image_path in images_dir.rglob("*"):
        if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue

        report.image_count += 1
        key = image_path.stem.lower()
        if key in seen_names:
            report.duplicate_count += 1
            report.issues.append(
                ImportIssue(
                    path=str(image_path),
                    issue_type="duplicate_image_name",
                    message="Another image with the same stem was already found.",
                )
            )
        seen_names.add(key)

        label_path = labels_dir / f"{image_path.stem}.txt"
        if not label_path.exists():
            report.queued_for_review += 1
            report.issues.append(
                ImportIssue(
                    path=str(label_path),
                    issue_type="missing_label",
                    message="Image has no matching YOLO label file.",
                )
            )
            continue

        text = label_path.read_text(encoding="utf-8").strip()
        if not text:
            report.queued_for_review += 1
            report.issues.append(
                ImportIssue(
                    path=str(label_path),
                    issue_type="empty_label",
                    message="Label file exists but has no annotations.",
                )
            )
            continue

        try:
            labels = parse_label_file(text, task)
        except YoloLabelError as exc:
            report.queued_for_review += 1
            report.issues.append(
                ImportIssue(
                    path=str(label_path),
                    issue_type="corrupted_label",
                    message=str(exc),
                )
            )
            continue

        report.valid_label_count += len(labels)

    return report
