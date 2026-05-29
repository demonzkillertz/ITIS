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
  source_path?: string | null;
  import_session_id?: string | null;
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

type ApiServerScanResult = {
  parent_dir?: string | null;
  image_dir?: string | null;
  video_dir?: string | null;
  label_dir?: string | null;
  image_count: number;
  video_count: number;
  label_count: number;
  matched_label_count: number;
  missing_label_count: number;
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
  source_type: "image_folder" | "video_folder" | "mixed_folder";
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

export type ModelOption = {
  key: string;
  label: string;
  task?: AnnotationTask | null;
  family: string;
  fileName: string;
  path?: string | null;
  isCustom: boolean;
  isDownloaded: boolean;
};

type ApiModelOption = {
  key: string;
  label: string;
  task?: AnnotationTask | null;
  family: string;
  file_name: string;
  path?: string | null;
  is_custom: boolean;
  is_downloaded: boolean;
};

type ApiModelCatalog = {
  vehicle_default: string;
  plate_default: string;
  models: ApiModelOption[];
};

export type ImportHistoryItem = {
  id: string;
  imageDir: string;
  videoDir?: string | null;
  labelDir?: string | null;
  parentDir?: string | null;
  sourceType: "image_folder" | "video_folder" | "mixed_folder";
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
    sourcePath: item.source_path ?? undefined,
    importSessionId: item.import_session_id ?? undefined,
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
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return importFolderAt(`/api/media/${datasetId}/server-folder`, {
    parentDir,
    imageDir,
    videoDir,
    labelDir,
    task,
    mode,
    duplicatePolicy,
    importImages,
    importVideos,
    extractVideoFrames,
    sampleEverySeconds,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

export async function importImageFolder(
  datasetId: string,
  parentDir: string,
  imageDir: string,
  labelDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy",
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return importFolderAt(`/api/media/${datasetId}/image-folder/import`, {
    parentDir,
    imageDir,
    videoDir: "",
    labelDir,
    task,
    mode,
    duplicatePolicy,
    importImages: true,
    importVideos: false,
    extractVideoFrames: false,
    sampleEverySeconds: 1,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

export async function importVideoFolder(
  datasetId: string,
  parentDir: string,
  videoDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy",
  extractVideoFrames: boolean,
  sampleEverySeconds: number,
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return importFolderAt(`/api/media/${datasetId}/video-folder/import`, {
    parentDir,
    imageDir: "",
    videoDir,
    labelDir: "",
    task,
    mode,
    duplicatePolicy,
    importImages: false,
    importVideos: true,
    extractVideoFrames,
    sampleEverySeconds,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

type FolderPayload = {
  parentDir: string;
  imageDir: string;
  videoDir: string;
  labelDir: string;
  task: AnnotationTask;
  mode: "auto" | "explicit";
  duplicatePolicy: "skip" | "import_copy";
  importImages: boolean;
  importVideos: boolean;
  extractVideoFrames: boolean;
  sampleEverySeconds: number;
  autoAnnotate: boolean;
  vehicleModelKey?: string;
  plateModelKey?: string;
};

async function importFolderAt(path: string, payload: FolderPayload) {
  const result = await request<ApiServerImportResult>(path, {
    method: "POST",
    body: JSON.stringify({
      parent_dir: payload.parentDir.trim() ? payload.parentDir : null,
      image_dir: payload.imageDir.trim() ? payload.imageDir : null,
      video_dir: payload.videoDir.trim() ? payload.videoDir : null,
      label_dir: payload.labelDir.trim() ? payload.labelDir : null,
      task: payload.task,
      mode: payload.mode,
      duplicate_policy: payload.duplicatePolicy,
      source_type: payload.importImages && payload.importVideos ? "mixed_folder" : payload.importVideos ? "video_folder" : "image_folder",
      import_images: payload.importImages,
      import_videos: payload.importVideos,
      extract_video_frames: payload.extractVideoFrames,
      video_sample_every_seconds: payload.sampleEverySeconds,
      auto_annotate: payload.autoAnnotate,
      tasks: payload.autoAnnotate ? ["vehicle", "plate"] : [payload.task],
      vehicle_model_key: payload.vehicleModelKey,
      plate_model_key: payload.plateModelKey
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
      sourcePath: item.source_path ?? undefined,
      importSessionId: item.import_session_id ?? undefined,
      parentMediaId: item.parent_media_id ?? undefined
    }))
  };
}

export async function scanServerFolder(
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
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return scanFolderAt(`/api/media/${datasetId}/server-folder/scan`, {
    parentDir,
    imageDir,
    videoDir,
    labelDir,
    task,
    mode,
    duplicatePolicy,
    importImages,
    importVideos,
    extractVideoFrames,
    sampleEverySeconds,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

export async function scanImageFolder(
  datasetId: string,
  parentDir: string,
  imageDir: string,
  labelDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy",
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return scanFolderAt(`/api/media/${datasetId}/image-folder/scan`, {
    parentDir,
    imageDir,
    videoDir: "",
    labelDir,
    task,
    mode,
    duplicatePolicy,
    importImages: true,
    importVideos: false,
    extractVideoFrames: false,
    sampleEverySeconds: 1,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

export async function scanVideoFolder(
  datasetId: string,
  parentDir: string,
  videoDir: string,
  task: AnnotationTask,
  mode: "auto" | "explicit",
  duplicatePolicy: "skip" | "import_copy",
  extractVideoFrames: boolean,
  sampleEverySeconds: number,
  autoAnnotate: boolean,
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return scanFolderAt(`/api/media/${datasetId}/video-folder/scan`, {
    parentDir,
    imageDir: "",
    videoDir,
    labelDir: "",
    task,
    mode,
    duplicatePolicy,
    importImages: false,
    importVideos: true,
    extractVideoFrames,
    sampleEverySeconds,
    autoAnnotate,
    vehicleModelKey,
    plateModelKey
  });
}

function scanFolderAt(path: string, payload: FolderPayload) {
  return request<ApiServerScanResult>(path, {
    method: "POST",
    body: JSON.stringify({
      parent_dir: payload.parentDir.trim() ? payload.parentDir : null,
      image_dir: payload.imageDir.trim() ? payload.imageDir : null,
      video_dir: payload.videoDir.trim() ? payload.videoDir : null,
      label_dir: payload.labelDir.trim() ? payload.labelDir : null,
      task: payload.task,
      mode: payload.mode,
      duplicate_policy: payload.duplicatePolicy,
      source_type: payload.importImages && payload.importVideos ? "mixed_folder" : payload.importVideos ? "video_folder" : "image_folder",
      import_images: payload.importImages,
      import_videos: payload.importVideos,
      extract_video_frames: payload.extractVideoFrames,
      video_sample_every_seconds: payload.sampleEverySeconds,
      auto_annotate: payload.autoAnnotate,
      tasks: payload.autoAnnotate ? ["vehicle", "plate"] : [payload.task],
      vehicle_model_key: payload.vehicleModelKey,
      plate_model_key: payload.plateModelKey
    })
  });
}

export async function listImportHistory(datasetId: string): Promise<ImportHistoryItem[]> {
  const history = await request<ApiImportHistoryItem[]>(`/api/media/${datasetId}/import-history`);
  return history.map((item) => ({
    id: item.id,
    parentDir: item.parent_dir,
    sourceType: item.source_type,
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

export async function listModels() {
  const catalog = await request<ApiModelCatalog>("/api/models");
  return {
    vehicleDefault: catalog.vehicle_default,
    plateDefault: catalog.plate_default,
    models: catalog.models.map((model) => ({
      key: model.key,
      label: model.label,
      task: model.task,
      family: model.family,
      fileName: model.file_name,
      path: model.path,
      isCustom: model.is_custom,
      isDownloaded: model.is_downloaded
    }))
  };
}

export async function downloadModels(keys?: string[]) {
  return request<{ message?: string }>("/api/models/download", {
    method: "POST",
    body: JSON.stringify({ keys: keys ?? null })
  });
}

export async function saveAnnotations(mediaId: string, annotations: Annotation[]) {
  const payload = annotations.map((annotation) => toApiAnnotation(mediaId, annotation));
  const saved = await request<ApiAnnotation[]>(`/api/annotations/${mediaId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return saved.map(fromApiAnnotation);
}

export async function extractFrames(
  mediaId: string,
  sampleEverySeconds: number,
  autoAnnotate: boolean,
  tasks: AnnotationTask[],
  vehicleModelKey?: string,
  plateModelKey?: string
) {
  return request<{ message?: string }>(`/api/media/${mediaId}/extract-frames`, {
    method: "POST",
    body: JSON.stringify({
      sample_every_seconds: sampleEverySeconds,
      auto_annotate: autoAnnotate,
      task: tasks[0] ?? "vehicle",
      tasks,
      vehicle_model_key: vehicleModelKey,
      plate_model_key: plateModelKey
    })
  });
}

export async function autoAnnotateMedia(mediaId: string, task: AnnotationTask, modelKey?: string) {
  const params = new URLSearchParams({ task });
  if (modelKey) {
    params.set("model_key", modelKey);
  }
  return request<{ message?: string }>(`/api/media/${mediaId}/auto-annotate?${params.toString()}`, {
    method: "POST"
  });
}

export async function deleteMedia(mediaId: string) {
  return request<{ message?: string }>(`/api/media/item/${mediaId}`, {
    method: "DELETE"
  });
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
