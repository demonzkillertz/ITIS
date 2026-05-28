from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator

from app.domain.classes import AnnotationTask


class AnnotationSource(StrEnum):
    MANUAL = "manual"
    MODEL = "model"
    IMPORT = "import"


class AnnotationStatus(StrEnum):
    DRAFT = "draft"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class FolderImportMode(StrEnum):
    AUTO = "auto"
    EXPLICIT = "explicit"


class DuplicatePolicy(StrEnum):
    SKIP = "skip"
    IMPORT_COPY = "import_copy"


class Box(BaseModel):
    x_center: float = Field(ge=0, le=1)
    y_center: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class AnnotationCreate(BaseModel):
    media_id: UUID
    task: AnnotationTask
    class_id: int
    box: Box
    confidence: float | None = Field(default=None, ge=0, le=1)
    source: AnnotationSource = AnnotationSource.MANUAL
    status: AnnotationStatus = AnnotationStatus.ACCEPTED


class AnnotationRead(AnnotationCreate):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class DatasetRead(DatasetCreate):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    image_count: int = 0
    labeled_count: int = 0


class ImportIssue(BaseModel):
    path: str
    issue_type: str
    message: str


class MediaRead(BaseModel):
    id: UUID
    dataset_id: UUID
    file_name: str
    image_url: str
    width: int
    height: int
    frame_index: int | None = None
    timestamp_seconds: float | None = None
    created_at: datetime


class ServerFolderImportCreate(BaseModel):
    parent_dir: str | None = None
    image_dir: str | None = None
    label_dir: str | None = None
    mode: FolderImportMode = FolderImportMode.AUTO
    task: AnnotationTask = AnnotationTask.VEHICLE
    duplicate_policy: DuplicatePolicy = DuplicatePolicy.SKIP


class ServerFolderImportRead(BaseModel):
    id: UUID | None = None
    parent_dir: str | None = None
    image_dir: str | None = None
    label_dir: str | None = None
    task: AnnotationTask = AnnotationTask.VEHICLE
    duplicate_policy: DuplicatePolicy = DuplicatePolicy.SKIP
    imported_images: int = 0
    imported_annotations: int = 0
    skipped_images: int = 0
    media: list[MediaRead] = Field(default_factory=list)
    issues: list[ImportIssue] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ImportSessionRead(BaseModel):
    id: UUID
    dataset_id: UUID
    parent_dir: str | None = None
    image_dir: str
    label_dir: str | None = None
    task: AnnotationTask
    duplicate_policy: DuplicatePolicy
    imported_images: int
    imported_annotations: int
    skipped_images: int
    issue_count: int
    created_at: datetime


class ImportReport(BaseModel):
    image_count: int = 0
    valid_label_count: int = 0
    queued_for_review: int = 0
    duplicate_count: int = 0
    issues: list[ImportIssue] = Field(default_factory=list)


class ProcessingJobRead(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    kind: str
    status: JobStatus = JobStatus.QUEUED
    message: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
