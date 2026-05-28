import type { Annotation, AnnotationClass, MediaSample } from "../types";

export const classes: AnnotationClass[] = [
  { id: 0, name: "bike", task: "vehicle", color: "#1f8a70" },
  { id: 1, name: "car", task: "vehicle", color: "#d95836" },
  { id: 2, name: "bus_microbus", task: "vehicle", color: "#6f5bd7" },
  { id: 3, name: "large_vehicle", task: "vehicle", color: "#b7791f" },
  { id: 0, name: "number_plate", task: "plate", color: "#0f766e" }
];

export const sampleMedia: MediaSample[] = [
  {
    id: "frame-001",
    fileName: "traffic_frame_001.jpg",
    imageUrl:
      "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1400&q=80",
    width: 1400,
    height: 933,
    frameIndex: 1,
    timestampSeconds: 1.0
  },
  {
    id: "frame-002",
    fileName: "traffic_frame_002.jpg",
    imageUrl:
      "https://images.unsplash.com/photo-1494522855154-9297ac14b55f?auto=format&fit=crop&w=1400&q=80",
    width: 1400,
    height: 933,
    frameIndex: 2,
    timestampSeconds: 2.0
  }
];

export const sampleAnnotations: Record<string, Annotation[]> = {
  "frame-001": [
    {
      id: "ann-001",
      task: "vehicle",
      classId: 1,
      className: "car",
      box: { xCenter: 0.5, yCenter: 0.62, width: 0.32, height: 0.28 },
      confidence: 0.91,
      source: "model",
      status: "draft"
    },
    {
      id: "ann-002",
      task: "plate",
      classId: 0,
      className: "number_plate",
      box: { xCenter: 0.51, yCenter: 0.71, width: 0.12, height: 0.045 },
      confidence: 0.73,
      source: "model",
      status: "draft"
    }
  ],
  "frame-002": []
};
