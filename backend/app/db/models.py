from datetime import datetime
from uuid import UUID as PythonUUID
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.domain.classes import AnnotationTask
from app.domain.schemas import (
    AnnotationSource,
    AnnotationStatus,
    DuplicatePolicy,
    ImportSourceType,
    JobStatus,
    MediaType,
)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    media_items: Mapped[list["MediaItem"]] = relationship(back_populates="dataset")
    import_sessions: Mapped[list["ImportSession"]] = relationship(back_populates="dataset")


class MediaItem(Base):
    __tablename__ = "media_items"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    dataset_id: Mapped[PythonUUID] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    media_type: Mapped[str] = mapped_column(String(20), default=MediaType.IMAGE.value)
    source_path: Mapped[str | None] = mapped_column(Text)
    import_session_id: Mapped[PythonUUID | None] = mapped_column(UUID(as_uuid=True))
    parent_media_id: Mapped[PythonUUID | None] = mapped_column(UUID(as_uuid=True))
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    frame_index: Mapped[int | None] = mapped_column(Integer)
    timestamp_seconds: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    dataset: Mapped[Dataset] = relationship(back_populates="media_items")
    annotations: Mapped[list["Annotation"]] = relationship(back_populates="media_item")


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    media_id: Mapped[PythonUUID] = mapped_column(ForeignKey("media_items.id"), nullable=False)
    task: Mapped[AnnotationTask] = mapped_column(Enum(AnnotationTask), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    x_center: Mapped[float] = mapped_column(Float, nullable=False)
    y_center: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[AnnotationSource] = mapped_column(Enum(AnnotationSource), nullable=False)
    status: Mapped[AnnotationStatus] = mapped_column(Enum(AnnotationStatus), nullable=False)
    is_prefetched: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by_user: Mapped[str | None] = mapped_column(String(120))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    media_item: Mapped[MediaItem] = relationship(back_populates="annotations")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    dataset_id: Mapped[PythonUUID | None] = mapped_column(ForeignKey("datasets.id"))
    kind: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), nullable=False, default=JobStatus.QUEUED)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    dataset_id: Mapped[PythonUUID] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    version_name: Mapped[str] = mapped_column(String(120), nullable=False)
    export_key: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ImportSession(Base):
    __tablename__ = "import_sessions"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    dataset_id: Mapped[PythonUUID] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    parent_dir: Mapped[str | None] = mapped_column(Text)
    image_dir: Mapped[str] = mapped_column(Text, nullable=False)
    video_dir: Mapped[str | None] = mapped_column(Text)
    label_dir: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[ImportSourceType] = mapped_column(Enum(ImportSourceType), nullable=False)
    task: Mapped[AnnotationTask] = mapped_column(Enum(AnnotationTask), nullable=False)
    duplicate_policy: Mapped[DuplicatePolicy] = mapped_column(Enum(DuplicatePolicy), nullable=False)
    imported_images: Mapped[int] = mapped_column(Integer, default=0)
    imported_videos: Mapped[int] = mapped_column(Integer, default=0)
    imported_frames: Mapped[int] = mapped_column(Integer, default=0)
    imported_annotations: Mapped[int] = mapped_column(Integer, default=0)
    model_annotations: Mapped[int] = mapped_column(Integer, default=0)
    skipped_images: Mapped[int] = mapped_column(Integer, default=0)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    dataset: Mapped[Dataset] = relationship(back_populates="import_sessions")


class VideoROI(Base):
    __tablename__ = "video_rois"

    id: Mapped[PythonUUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    dataset_id: Mapped[PythonUUID] = mapped_column(ForeignKey("datasets.id"), nullable=False)
    video_name: Mapped[str] = mapped_column(String(255), nullable=False)
    polygon: Mapped[list[dict[str, float]]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
