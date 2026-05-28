# Architecture

## High-Level Flow

```text
React annotation UI
  -> FastAPI REST API
  -> PostgreSQL metadata
  -> File storage for images, frames, labels, exports
  -> Redis queue
  -> GPU workers for frame extraction and YOLO inference
```

## Backend Modules

- `app.api`: HTTP routes for datasets, media, and annotations.
- `app.core`: configuration and shared application setup.
- `app.domain`: shared schemas, class maps, task states, and enums.
- `app.services`: label parsing, dataset import, frame extraction, inference,
  statistics, and export logic.
- `app.workers`: queue tasks for long-running video and AI operations.

## Data Model

Core entities:

- Dataset: named collection of media samples and export versions.
- MediaItem: original image, extracted frame, or imported sample.
- Annotation: human or AI-generated bounding box in normalized YOLO format.
- ProcessingJob: async task state for import, extraction, inference, or export.
- DatasetVersion: immutable export snapshot.

## Processing Pipeline

1. User uploads images, videos, or dataset archive.
2. API stores the upload and creates a processing job.
3. Worker extracts frames if the source is video.
4. Worker runs vehicle and number plate models.
5. Draft annotations are stored with confidence and source metadata.
6. Human reviewer accepts, edits, or rejects annotations.
7. Export creates YOLO-compatible folders and `data.yaml`.

## Annotation State

Annotations should carry enough metadata to support review:

- `class_id`
- `task`: vehicle or plate
- Normalized box coordinates
- `confidence`
- `source`: manual, model, or import
- `status`: draft, accepted, rejected
- `created_at` and `updated_at`

## Storage Strategy

Recommended local development layout:

```text
storage/
  uploads/
  datasets/
  frames/
  exports/
  models/
```

The application should reference files by stable database IDs and relative
storage keys, not by absolute paths.

## Reliability

- Uploads and long-running processing tasks are represented as resumable jobs.
- Auto-save should write small annotation changes frequently.
- Export jobs should create a new version instead of mutating previous exports.
- Workers should be idempotent where possible so failed jobs can be retried.

## Active Learning Readiness

Keep prediction confidence, model name, model version, and reviewer decisions.
Those fields make it possible to mine difficult samples and retrain models
later without changing the annotation contract.
