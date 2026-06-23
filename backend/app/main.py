from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.routes import annotations, datasets, export, media, yolo_models
from app.core.config import settings
from app.db.base import Base
from app.db.models import Annotation, Dataset, DatasetVersion, ImportSession, MediaItem, ProcessingJob
from app.db.session import engine


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    _ = (Annotation, Dataset, DatasetVersion, ImportSession, MediaItem, ProcessingJob)
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    (settings.storage_root / "uploads").mkdir(parents=True, exist_ok=True)
    (settings.storage_root / "frames").mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    ensure_runtime_schema()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])
    app.include_router(media.router, prefix="/api/media", tags=["media"])
    app.include_router(annotations.router, prefix="/api/annotations", tags=["annotations"])
    app.include_router(yolo_models.router, prefix="/api/models", tags=["models"])
    app.include_router(export.router, prefix="/api/export", tags=["export"])
    app.mount("/storage", StaticFiles(directory=settings.storage_root), name="storage")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    return app


def ensure_runtime_schema() -> None:
    statements = [
        "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'image'",
        "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS source_path TEXT",
        "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS import_session_id UUID",
        "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS parent_media_id UUID",
        "ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS video_dir TEXT",
        "ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) DEFAULT 'mixed_folder'",
        "ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS imported_videos INTEGER DEFAULT 0",
        "ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS imported_frames INTEGER DEFAULT 0",
        "ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS model_annotations INTEGER DEFAULT 0",
        "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS is_prefetched BOOLEAN DEFAULT FALSE",
        "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS reviewed_by_user VARCHAR(120)",
        "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


app = create_app()
