from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import annotations, datasets, media
from app.core.config import settings
from app.db.base import Base
from app.db.models import Annotation, Dataset, DatasetVersion, ImportSession, MediaItem, ProcessingJob
from app.db.session import engine


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    _ = (Annotation, Dataset, DatasetVersion, ImportSession, MediaItem, ProcessingJob)
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    (settings.storage_root / "uploads").mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])
    app.include_router(media.router, prefix="/api/media", tags=["media"])
    app.include_router(annotations.router, prefix="/api/annotations", tags=["annotations"])
    app.mount("/storage", StaticFiles(directory=settings.storage_root), name="storage")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    return app


app = create_app()
