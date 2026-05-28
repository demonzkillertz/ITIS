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
2. For large local datasets, user provides backend-accessible folder paths.
3. API records an import session and copies/scans selected source media.
4. Existing YOLO labels are imported as pre-fetched annotations.
5. Worker extracts frames if the source is video.
6. Worker runs vehicle and number plate models when AI assistance is enabled.
7. Draft annotations are stored with confidence and source metadata.
8. Human reviewer accepts, edits, or rejects annotations.
9. Export creates YOLO-compatible folders and `data.yaml`.

## Annotation State

Annotations should carry enough metadata to support review:

- `class_id`
- `task`: vehicle or plate
- Normalized box coordinates
- `confidence`
- `source`: manual, model, or import
- `is_prefetched`: true for labels imported from existing YOLO text files
- `status`: draft, accepted, rejected
- `reviewed_by_user`
- `verified_at`
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

Original server source paths are retained as metadata for import history and
traceability. Browser rendering always uses copied app-storage paths.

## Workstation Processing

Target local workstation:

- Intel i9-10850K
- 64 GB RAM
- NVIDIA RTX 3060 12 GB

Frame extraction should use CPU parallelism. YOLO inference should be queued so
GPU work is batched and does not block the browser API. Import sessions,
processing jobs, and annotation status make interrupted work resumable.

## Reliability

- Uploads and long-running processing tasks are represented as resumable jobs.
- Auto-save should write small annotation changes frequently.
- Export jobs should create a new version instead of mutating previous exports.
- Workers should be idempotent where possible so failed jobs can be retried.

## Active Learning Readiness

Keep prediction confidence, model name, model version, and reviewer decisions.
Those fields make it possible to mine difficult samples and retrain models
later without changing the annotation contract.
