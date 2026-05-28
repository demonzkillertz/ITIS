# System Requirements

## Objective

Build a browser-based AI-assisted annotation system for traffic intelligence
and ANPR dataset generation. The platform helps users create YOLO-compatible
datasets for vehicle detection and number plate detection from images, videos,
and incomplete existing datasets.

## Supported Tasks

Vehicle detection classes:

```yaml
0: bike
1: car
2: bus_microbus
3: large_vehicle
```

Number plate detection class:

```yaml
0: number_plate
```

The same image can contain multiple vehicle boxes and multiple number plate
boxes. Boxes may overlap and may describe partially visible or occluded objects.

## Inputs

- Images: JPG, JPEG, PNG
- Videos: MP4, AVI, MOV, MKV
- Dataset archives: ZIP files containing YOLO-style images, labels, and
  optional `data.yaml`
- Server-local folders directly accessible by the backend

Primary production flow assumes data is already copied onto the workstation.
Browser upload remains available for small ad-hoc files, but backend folder
scanning is the preferred path for large datasets.

## Default User Flow

1. User imports a server-local parent folder, image folder, video folder, or
   YOLO-style dataset folder.
2. The first view is the imported image/frame gallery.
3. User opens an image or extracted video frame.
4. Existing YOLO labels appear as pre-fetched annotations.
5. AI model detections appear as soft draft suggestions.
6. User corrects vehicle category, number plate boxes, and any missing boxes.
7. User accepts annotations; verified records store human review metadata.
8. Final exports use YOLO normalized text format.

The system must support completed, partially completed, and unannotated imports
without requiring the user to separate those cases manually.

## Video Processing

The frame extraction pipeline should support:

- Configurable frame sampling rate
- Motion-aware extraction
- Duplicate frame reduction
- Blur filtering
- Low-quality frame rejection
- Scene-change detection

The goal is to reduce redundant annotations while keeping diverse traffic
scenes.

## AI-Assisted Annotation

The system integrates two model roles:

- Vehicle YOLO model: bike, car, bus_microbus, large_vehicle
- Plate YOLO model: number_plate

AI annotations must be stored as suggestions first. They should preserve model
source, confidence, and draft status until a human reviewer accepts or edits
them. Human verification must record who verified the suggestion and when.

Imported YOLO labels must be marked as pre-fetched annotations so the user can
distinguish existing dataset work from AI suggestions and new manual labels.

Default processing flow:

```text
Upload media
  -> Extract frames
  -> Run vehicle detection
  -> Run plate detection
  -> Generate draft labels
  -> Human review and correction
  -> Save final labels
```

## Annotation Interface

The browser UI should support:

- Gallery-first browsing of imported images and extracted video frames
- Create, resize, move, delete, duplicate, and relabel bounding boxes
- Previous and next image navigation
- Video frame timeline
- Zoom, pan, and fullscreen mode
- Keyboard shortcuts
- Auto-save
- Undo and redo
- Confidence filtering
- Annotation history

## Dataset Import

Supported YOLO input structure:

```text
dataset/
  images/
  labels/
  data.yaml
```

Also supported:

```text
dataset/
  images/
  labels/
  videos/
```

or explicit independent paths for images, labels, and videos.

The importer should detect:

- Missing label files
- Empty label files
- Corrupted labels
- Unlabeled images
- Mismatched image-label pairs
- Duplicate images

Valid annotations must be preserved. Incomplete samples should be queued for
annotation or model-assisted pre-labeling.

Import history must be saved, including server paths, media counts, extracted
frame counts, imported label counts, AI-generated annotation counts, skipped
duplicates, and issue counts.

## Video Dataset Flow

Videos are imported as source records. The backend extracts sampled frames into
stored image records. Vehicle and number plate models may pre-annotate those
frames. Human review confirms final boxes and categories.

Video frame collections should remain traceable to the source video and should
support later collage/contact-sheet views for fast review.

## Dataset Management

The platform should provide:

- Dataset creation
- Dataset versioning
- Train, validation, and test splitting
- Progress tracking
- Class statistics
- Export management

## Non-Functional Requirements

- Smooth browser interaction for image annotation
- Fast image loading
- Asynchronous video processing and inference
- GPU-accelerated model execution
- Parallel frame extraction and model inference tuned for an i9-10850K,
  64 GB RAM, and RTX 3060 12 GB workstation
- Crash recovery and resumable processing
- Modular backend and API-driven frontend
- Multi-dataset scalability

## Future Expansion

The architecture should allow future support for:

- OCR number plate recognition
- Vehicle tracking IDs
- Speed estimation
- Traffic analytics
- Multi-user collaboration
- Reviewer workflows
- Cloud deployment
- Active learning automation
