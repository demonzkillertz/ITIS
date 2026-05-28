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
  media_type: "image" | "video";
  width: number;
  height: number;
  frame_index?: number | null;
  timestamp_seconds?: number | null;
  parent_media_id?: string | null;
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
  is_prefetched?: boolean;
  reviewed_by_user?: string | null;
  verified_at?: string | null;
};

type ApiServerImportResult = {
  id?: string | null;
  parent_dir?: string | null;
  image_dir?: string | null;
  video_dir?: string | null;
  label_dir?: string | null;
  task: AnnotationTask;
  duplicate_policy: "skip" | "import_copy";
  imported_images: number;
  imported_videos: number;
  imported_frames: number;
  imported_annotations: number;
  model_annotations: number;
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
  video_dir?: string | null;
  label_dir?: string | null;
  task: AnnotationTask;
  duplicate_policy: "skip" | "import_copy";
  imported_images: number;
  imported_videos: number;
  imported_frames: number;
  imported_annotations: number;
  model_annotations: number;
  skipped_images: number;
  issue_count: number;
  created_at: string;
};

export type ImportHistoryItem = {
  id: string;
  imageDir: string;
  videoDir?: string | null;
  labelDir?: string | null;
  parentDir?: string | null;
  task: AnnotationTask;
  importedImages: number;
  importedVideos: number;
  importedFrames: number;
  importedAnnotations: number;
  modelAnnotations: number;
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
    mediaType: item.media_type,
    width: item.width,
    height: item.height,
    frameIndex: item.frame_index ?? undefined,
    timestampSeconds: item.timestamp_seconds ?? undefined,
    parentMediaId: item.parent_media_id ?? undefined
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
    mediaType: item.media_type,
    width: item.width,
    height: item.height
  }));
}

export async function importServerFolder(
  datasetId: string,
  parentDir: string,
  imageDir: string,
  videoDir: string,
  labelDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy",
  importImages: boolean,
  importVideos: boolean,
  extractVideoFrames: boolean,
  sampleEverySeconds: number,
  autoAnnotate: boolean
) {
  const result = await request<ApiServerImportResult>(`/api/media/${datasetId}/server-folder`, {
    method: "POST",
    body: JSON.stringify({
      parent_dir: parentDir.trim() ? parentDir : null,
      image_dir: imageDir.trim() ? imageDir : null,
      video_dir: videoDir.trim() ? videoDir : null,
      label_dir: labelDir.trim() ? labelDir : null,
      task: task,
      mode: mode,
      duplicate_policy: duplicatePolicy,
      source_type: importImages && importVideos ? "mixed_folder" : importVideos ? "video_folder" : "image_folder",
      import_images: importImages,
      import_videos: importVideos,
      extract_video_frames: extractVideoFrames,
      video_sample_every_seconds: sampleEverySeconds,
      auto_annotate: autoAnnotate
    })
  });

  return {
    importedImages: result.imported_images,
    importedVideos: result.imported_videos,
    importedFrames: result.imported_frames,
    importedAnnotations: result.imported_annotations,
    modelAnnotations: result.model_annotations,
    skippedImages: result.skipped_images,
    issueCount: result.issues.length,
    media: result.media.map((item) => ({
      id: item.id,
      fileName: item.file_name,
      imageUrl: item.image_url,
      mediaType: item.media_type,
      width: item.width,
      height: item.height,
      frameIndex: item.frame_index ?? undefined,
      timestampSeconds: item.timestamp_seconds ?? undefined,
      parentMediaId: item.parent_media_id ?? undefined
    }))
  };
}

export async function listImportHistory(datasetId: string): Promise<ImportHistoryItem[]> {
  const history = await request<ApiImportHistoryItem[]>(`/api/media/${datasetId}/import-history`);
  return history.map((item) => ({
    id: item.id,
    parentDir: item.parent_dir,
    imageDir: item.image_dir,
    videoDir: item.video_dir,
    labelDir: item.label_dir,
    task: item.task,
    importedImages: item.imported_images,
    importedVideos: item.imported_videos,
    importedFrames: item.imported_frames,
    importedAnnotations: item.imported_annotations,
    modelAnnotations: item.model_annotations,
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
    status: annotation.status,
    isPrefetched: annotation.is_prefetched ?? false,
    reviewedByUser: annotation.reviewed_by_user ?? null,
    verifiedAt: annotation.verified_at ?? null
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
    status: annotation.status,
    is_prefetched: annotation.isPrefetched ?? false,
    reviewed_by_user: annotation.reviewedByUser ?? null,
    verified_at: annotation.verifiedAt ?? null
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
