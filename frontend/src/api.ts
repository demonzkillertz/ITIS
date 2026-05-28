import { classes } from "./data/sample";
import type { Annotation, AnnotationClass, AnnotationTask, Box, MediaSample } from "./types";

const API_BASE = "";

type ApiDataset = {
  id: string;
  name: string;
  description?: string | null;
  image_count: number;
  labeled_count: number;
};

type ApiMedia = {
  id: string;
  dataset_id: string;
  file_name: string;
  image_url: string;
  width: number;
  height: number;
  frame_index?: number | null;
  timestamp_seconds?: number | null;
};

type ApiAnnotation = {
  id: string;
  media_id: string;
  task: AnnotationTask;
  class_id: number;
  box: {
    x_center: number;
    y_center: number;
    width: number;
    height: number;
  };
  confidence?: number | null;
  source: "manual" | "model" | "import";
  status: "draft" | "accepted" | "rejected";
};

type ApiServerImportResult = {
  id?: string | null;
  parent_dir?: string | null;
  image_dir?: string | null;
  label_dir?: string | null;
  task: AnnotationTask;
  duplicate_policy: "skip" | "import_copy";
  imported_images: number;
  imported_annotations: number;
  skipped_images: number;
  media: ApiMedia[];
  issues: Array<{
    path: string;
    issue_type: string;
    message: string;
  }>;
};

type ApiImportHistoryItem = {
  id: string;
  dataset_id: string;
  parent_dir?: string | null;
  image_dir: string;
  label_dir?: string | null;
  task: AnnotationTask;
  duplicate_policy: "skip" | "import_copy";
  imported_images: number;
  imported_annotations: number;
  skipped_images: number;
  issue_count: number;
  created_at: string;
};

export type ImportHistoryItem = {
  id: string;
  imageDir: string;
  labelDir?: string | null;
  parentDir?: string | null;
  task: AnnotationTask;
  importedImages: number;
  importedAnnotations: number;
  skippedImages: number;
  issueCount: number;
  createdAt: string;
};

export async function ensureDataset(): Promise<ApiDataset> {
  const datasets = await request<ApiDataset[]>("/api/datasets");
  if (datasets.length > 0) {
    return datasets[0];
  }
  return request<ApiDataset>("/api/datasets", {
    method: "POST",
    body: JSON.stringify({
      name: "Traffic Annotation Dataset",
      description: "Default dataset created from the annotation UI"
    })
  });
}

export async function listMedia(datasetId: string): Promise<MediaSample[]> {
  const media = await request<ApiMedia[]>(`/api/media/${datasetId}/items`);
  return media.map((item) => ({
    id: item.id,
    fileName: item.file_name,
    imageUrl: item.image_url,
    width: item.width,
    height: item.height,
    frameIndex: item.frame_index ?? undefined,
    timestampSeconds: item.timestamp_seconds ?? undefined
  }));
}

export async function uploadImages(datasetId: string, files: FileList): Promise<MediaSample[]> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  const media = await request<ApiMedia[]>(`/api/media/${datasetId}/images`, {
    method: "POST",
    body: formData
  });
  return media.map((item) => ({
    id: item.id,
    fileName: item.file_name,
    imageUrl: item.image_url,
    width: item.width,
    height: item.height
  }));
}

export async function importServerFolder(
  datasetId: string,
  parentDir: string,
  imageDir: string,
  labelDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy"
) {
  const result = await request<ApiServerImportResult>(`/api/media/${datasetId}/server-folder`, {
    method: "POST",
    body: JSON.stringify({
      parent_dir: parentDir.trim() ? parentDir : null,
      image_dir: imageDir.trim() ? imageDir : null,
      label_dir: labelDir.trim() ? labelDir : null,
      task: task,
      mode: mode,
      duplicate_policy: duplicatePolicy
    })
  });

  return {
    importedImages: result.imported_images,
    importedAnnotations: result.imported_annotations,
    skippedImages: result.skipped_images,
    issueCount: result.issues.length,
    media: result.media.map((item) => ({
      id: item.id,
      fileName: item.file_name,
      imageUrl: item.image_url,
      width: item.width,
      height: item.height,
      frameIndex: item.frame_index ?? undefined,
      timestampSeconds: item.timestamp_seconds ?? undefined
    }))
  };
}

export async function listImportHistory(datasetId: string): Promise<ImportHistoryItem[]> {
  const history = await request<ApiImportHistoryItem[]>(`/api/media/${datasetId}/import-history`);
  return history.map((item) => ({
    id: item.id,
    parentDir: item.parent_dir,
    imageDir: item.image_dir,
    labelDir: item.label_dir,
    task: item.task,
    importedImages: item.imported_images,
    importedAnnotations: item.imported_annotations,
    skippedImages: item.skipped_images,
    issueCount: item.issue_count,
    createdAt: item.created_at
  }));
}

export async function listAnnotations(mediaId: string): Promise<Annotation[]> {
  const annotations = await request<ApiAnnotation[]>(`/api/annotations/${mediaId}`);
  return annotations.map(fromApiAnnotation);
}

export async function saveAnnotations(mediaId: string, annotations: Annotation[]) {
  const payload = annotations.map((annotation) => toApiAnnotation(mediaId, annotation));
  const saved = await request<ApiAnnotation[]>(`/api/annotations/${mediaId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return saved.map(fromApiAnnotation);
}

function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${API_BASE}${path}`, { ...init, headers }).then(async (response) => {
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  });
}

function fromApiAnnotation(annotation: ApiAnnotation): Annotation {
  const annotationClass = findClass(annotation.task, annotation.class_id);
  return {
    id: annotation.id,
    task: annotation.task,
    classId: annotation.class_id,
    className: annotationClass.name,
    box: fromApiBox(annotation.box),
    confidence: annotation.confidence ?? undefined,
    source: annotation.source,
    status: annotation.status
  };
}

function toApiAnnotation(mediaId: string, annotation: Annotation) {
  return {
    media_id: mediaId,
    task: annotation.task,
    class_id: annotation.classId,
    box: toApiBox(annotation.box),
    confidence: annotation.confidence ?? null,
    source: annotation.source,
    status: annotation.status
  };
}

function fromApiBox(box: ApiAnnotation["box"]): Box {
  return {
    xCenter: box.x_center,
    yCenter: box.y_center,
    width: box.width,
    height: box.height
  };
}

function toApiBox(box: Box) {
  return {
    x_center: box.xCenter,
    y_center: box.yCenter,
    width: box.width,
    height: box.height
  };
}

function findClass(task: AnnotationTask, classId: number): AnnotationClass {
  return (
    classes.find((annotationClass) => annotationClass.task === task && annotationClass.id === classId) ??
    classes[0]
  );
}
