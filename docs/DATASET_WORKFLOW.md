# Dataset Workflow

## Import

Accepted archive structure:

```text
dataset/
  images/
  labels/
  data.yaml
```

Import should preserve valid image and label pairs and produce an issue report
for incomplete samples.

## Validation Rules

A YOLO label row is valid when:

- It contains exactly five fields.
- `class_id` is an integer.
- `x_center`, `y_center`, `width`, and `height` are numeric.
- Normalized coordinates are between 0 and 1.
- `width` and `height` are greater than 0.
- The class belongs to the selected task.

## Recovery Queue

Samples enter the annotation queue when:

- The label file is missing.
- The label file is empty.
- One or more label rows are invalid.
- The image has no matching label file.
- Duplicate images need review.

## Export

Each export version should produce:

```text
export-name/
  images/
    train/
    val/
    test/
  labels/
    train/
    val/
    test/
  data.yaml
```

Vehicle and number plate datasets may be exported separately because their
class IDs are both zero-based inside their own model tasks.
