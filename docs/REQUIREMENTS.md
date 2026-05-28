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

The importer should detect:

- Missing label files
- Empty label files
- Corrupted labels
- Unlabeled images
- Mismatched image-label pairs
- Duplicate images

Valid annotations must be preserved. Incomplete samples should be queued for
annotation or model-assisted pre-labeling.

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
