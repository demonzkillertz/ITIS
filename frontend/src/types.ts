export type AnnotationTask = "vehicle" | "plate";
export type AnnotationSource = "manual" | "model" | "import";
export type AnnotationStatus = "draft" | "accepted" | "rejected";

export type AnnotationClass = {
  id: number;
  name: string;
  task: AnnotationTask;
  color: string;
};

export type Box = {
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
};

export type Annotation = {
  id: string;
  classId: number;
  className: string;
  task: AnnotationTask;
  box: Box;
  confidence?: number;
  source: AnnotationSource;
  status: AnnotationStatus;
  isPrefetched?: boolean;
  reviewedByUser?: string | null;
  verifiedAt?: string | null;
};

export type MediaSample = {
  id: string;
  fileName: string;
  imageUrl: string;
  mediaType: "image" | "video";
  width: number;
  height: number;
  frameIndex?: number;
  timestampSeconds?: number;
  importSessionId?: string;
  parentMediaId?: string;
  sourcePath?: string;
};
