# ITIS: AI-Assisted Traffic Annotation Platform

Final year project for BE Computer at Khwopa Engineering College.

ITIS is a browser-based annotation platform for building high-quality vehicle
and number plate detection datasets from traffic images and videos. It is
designed to reduce manual labeling effort through video frame extraction,
YOLO-assisted pre-annotation, incomplete dataset recovery, and human review.

## Core Capabilities

- Annotate vehicles and number plates on the same image or video frame.
- Import images, videos, and YOLO dataset archives.
- Extract useful frames from traffic videos with sampling, blur filtering,
  duplicate reduction, and scene-change detection.
- Run separate YOLO models for vehicle and number plate pre-annotation.
- Review, correct, and export YOLO-compatible labels.
- Detect incomplete datasets and queue missing or invalid samples for review.
- Track dataset progress, class counts, splits, and export versions.

## Annotation Classes

Vehicle detection:

```yaml
0: bike
1: car
2: bus_microbus
3: large_vehicle
```

Number plate detection:

```yaml
0: number_plate
```

Vehicle and plate annotations can coexist on the same image. Export pipelines
can produce separate label sets for vehicle and plate models.

## Recommended Stack

- Backend: Python, FastAPI, PostgreSQL
- Async processing: Redis with Celery or RQ
- Frontend: React, Vite, Konva.js
- AI and media: Ultralytics YOLO, OpenCV, FFmpeg
- Target hardware: NVIDIA RTX 3060 12GB, Intel i9-10850K, 64GB RAM

## Repository Layout

```text
backend/              FastAPI API, dataset import, labels, workers
frontend/             React annotation interface scaffold
docs/                 Requirements, architecture, and workflow notes
docker-compose.yml    Local PostgreSQL and Redis services
```

## Local Development

Backend:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements-dev.txt
copy backend\.env.example backend\.env
cd backend
uvicorn app.main:app --reload
```

For the current local setup, PostgreSQL is configured as:

```text
database: itis
user: postgres
password: admin
```

Create the database if needed:

```powershell
$env:PGPASSWORD="admin"
psql -U postgres -h localhost -p 5432 -d postgres -c "CREATE DATABASE itis"
```

If you are already inside the `backend` folder:

```powershell
..\venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --reload
```

If you prefer editable installs from `pyproject.toml`, use:

```powershell
pip install -e ".[dev]"
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Server-side folder import:

- Open `http://127.0.0.1:5173`.
- In the review panel, enter the server image folder path, for example
  `C:\datasets\traffic\images`.
- Optionally enter the matching YOLO label folder path, for example
  `C:\datasets\traffic\labels`.
- Choose whether the labels are `Vehicle` or `Number plate`, then click
  `Import`.

Images are copied into app storage so the browser can display them. Matching
YOLO labels are imported from files with the same image stem, such as
`car_001.jpg` and `car_001.txt`.

Infrastructure:

```powershell
docker compose up -d postgres redis
```

## Documentation

- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Dataset Workflow](docs/DATASET_WORKFLOW.md)

## MVP Scope

The current scaffold establishes the project contracts and starter modules for:

1. Dataset creation and import.
2. YOLO label parsing and validation.
3. Video frame extraction interfaces.
4. Inference task orchestration.
5. Browser annotation canvas layout.

The next engineering milestone is wiring persistence, upload storage, and real
worker execution into the scaffold.
