import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text, Line, Group } from "react-konva";

import { classes } from "../data/sample";
import type { Annotation, AnnotationClass, Box, MediaSample, Point } from "../types";

type CanvasProps = {
  media: MediaSample;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  selectedClass: AnnotationClass;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (annotation: Annotation) => void;
  isDrawingROI?: boolean;
  roiDraft?: Point[];
  onROIClick?: (point: Point) => void;
};

type PixelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function useImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const nextImage = new window.Image();
    setImage(null);
    setFailed(false);
    nextImage.onload = () => setImage(nextImage);
    nextImage.onerror = () => setFailed(true);
    nextImage.src = url;

    return () => {
      nextImage.onload = null;
      nextImage.onerror = null;
      nextImage.src = ""; // This cancels the pending request
    };
  }, [url]);

  return { image, failed };
}

function toPixelBox(box: Box, width: number, height: number): PixelBox {
  return {
    x: (box.xCenter - box.width / 2) * width,
    y: (box.yCenter - box.height / 2) * height,
    width: box.width * width,
    height: box.height * height
  };
}

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

function toNormalizedBox(box: PixelBox, width: number, height: number): Box {
  const x = clamp(box.x, 0, width);
  const y = clamp(box.y, 0, height);
  const right = clamp(box.x + box.width, 0, width);
  const bottom = clamp(box.y + box.height, 0, height);
  const newWidth = right - x;
  const newHeight = bottom - y;

  return {
    xCenter: clamp((x + newWidth / 2) / width, 0, 1),
    yCenter: clamp((y + newHeight / 2) / height, 0, 1),
    width: clamp(newWidth / width, 0, 1),
    height: clamp(newHeight / height, 0, 1)
  };
}

export default function AnnotationCanvas({
  media,
  annotations,
  selectedAnnotationId,
  selectedClass,
  onAddAnnotation,
  onSelectAnnotation,
  onUpdateAnnotation,
  isDrawingROI,
  roiDraft,
  onROIClick
}: CanvasProps) {
  const { image, failed: imageFailed } = useImage(media.imageUrl);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<PixelBox | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const annotationIndices = useMemo(() => {
    const indices: Record<string, number> = {};
    const result: Record<string, number> = {};
    // Ensure consistent ordering, for example by id or coordinates, but for now array order is fine.
    annotations.forEach((ann) => {
      const current = indices[ann.className] || 0;
      indices[ann.className] = current + 1;
      result[ann.id] = indices[ann.className];
    });
    return result;
  }, [annotations]);

  const canvasSize = useMemo(() => {
    const maxHeight = 720;
    const scale = Math.min(containerWidth / media.width, maxHeight / media.height);
    return {
      width: Math.round(media.width * scale),
      height: Math.round(media.height * scale),
      scale
    };
  }, [containerWidth, media.height, media.width]);

  function annotationColor(annotation: Annotation) {
    return (
      classes.find(
        (annotationClass) =>
          annotationClass.task === annotation.task && annotationClass.id === annotation.classId
      )?.color ?? (annotation.task === "plate" ? "#14b8a6" : "#f97316")
    );
  }

  function pointerPosition(event: { target: { getStage: () => any } }) {
    const stage = event.target.getStage();
    return stage?.getPointerPosition() ?? { x: 0, y: 0 };
  }

  function startDrawing(event: any) {
    if (isDrawingROI) return;
    const stage = event.target.getStage();
    const targetClass = event.target.getClassName?.();
    const targetName = event.target.name?.();
    if (event.target !== stage && targetClass !== "Image" && targetName !== "polygon-boundary") {
      return;
    }
    const point = pointerPosition(event);
    setDrawingStart(point);
    setDraftBox({ x: point.x, y: point.y, width: 0, height: 0 });
    onSelectAnnotation(null);
  }

  function continueDrawing(event: any) {
    if (!drawingStart) {
      return;
    }
    const point = pointerPosition(event);
    setDraftBox({
      x: Math.min(drawingStart.x, point.x),
      y: Math.min(drawingStart.y, point.y),
      width: Math.abs(point.x - drawingStart.x),
      height: Math.abs(point.y - drawingStart.y)
    });
  }

  function finishDrawing() {
    if (!draftBox || draftBox.width < 8 || draftBox.height < 8) {
      setDrawingStart(null);
      setDraftBox(null);
      return;
    }

    const normalized = toNormalizedBox(draftBox, canvasSize.width, canvasSize.height);
    onAddAnnotation({
      id: crypto.randomUUID(),
      task: selectedClass.task,
      classId: selectedClass.id,
      className: selectedClass.name,
      box: normalized,
      source: "manual",
      status: "accepted"
    });
    setDrawingStart(null);
    setDraftBox(null);
  }

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <Stage
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={startDrawing}
        onMouseUp={finishDrawing}
        onMouseMove={continueDrawing}
        onClick={(e) => {
          if (isDrawingROI && onROIClick) {
            const stage = e.target.getStage();
            const pointer = stage?.getPointerPosition();
            if (pointer) {
              onROIClick({ 
                x: clamp(pointer.x / canvasSize.width, 0, 1), 
                y: clamp(pointer.y / canvasSize.height, 0, 1) 
              });
            }
          }
        }}
      >
        <Layer>
          {image ? (
            <KonvaImage image={image} width={canvasSize.width} height={canvasSize.height} />
          ) : (
            <Rect width={canvasSize.width} height={canvasSize.height} fill="#17202a" />
          )}
          {imageFailed ? (
            <Text
              x={24}
              y={24}
              text="Image could not be loaded"
              fontSize={16}
              fill="#f8fafc"
              listening={false}
            />
          ) : null}
        </Layer>
        <Layer>
          {annotations.map((annotation) => {
            if (annotation.polygon && annotation.polygon.length > 0) return null;
            const box = toPixelBox(annotation.box, canvasSize.width, canvasSize.height);
            const color = annotationColor(annotation);
            const selected = annotation.id === selectedAnnotationId;
            return (
              <Rect
                key={annotation.id}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill={selected ? `${color}33` : `${color}1f`}
                stroke={selected ? "#f8fafc" : color}
                strokeWidth={selected ? 4 : 3}
                dash={annotation.status === "draft" ? [8, 5] : undefined}
                draggable
                onClick={() => onSelectAnnotation(annotation.id)}
                onTap={() => onSelectAnnotation(annotation.id)}
                onDragEnd={(event) => {
                  onUpdateAnnotation({
                    ...annotation,
                    box: toNormalizedBox(
                      { ...box, x: event.target.x(), y: event.target.y() },
                      canvasSize.width,
                      canvasSize.height
                    )
                  });
                }}
              />
            );
          })}
          {/* Render polygons for annotations that have them */}
          {annotations.map((annotation) => {
            if (!annotation.polygon || annotation.polygon.length === 0) return null;
            const selected = annotation.id === selectedAnnotationId;
            const color = annotationColor(annotation);
            return (
              <Line
                key={`${annotation.id}-polygon`}
                name="polygon-boundary"
                points={annotation.polygon.flatMap((p) => [p.x * canvasSize.width, p.y * canvasSize.height])}
                closed
                stroke={selected ? "#f8fafc" : color}
                strokeWidth={selected ? 3 : 2}
                fill={selected ? `${color}33` : `${color}1f`}
                onClick={() => onSelectAnnotation(annotation.id)}
                onTap={() => onSelectAnnotation(annotation.id)}
                listening={true}
              />
            );
          })}
          {annotations.map((annotation) => {
            const box = toPixelBox(annotation.box, canvasSize.width, canvasSize.height);
            const color = annotationColor(annotation);
            const index = annotationIndices[annotation.id];
            const label = `${index} ${annotation.className}${annotation.confidence ? ` ${Math.round(annotation.confidence * 100)}%` : ""}`;
            const labelWidth = Math.max(76, label.length * 7 + 10);
            const labelY = Math.max(0, box.y - 23);
            return (
              <Fragment key={`${annotation.id}-label-wrap`}>
                <Rect
                  key={`${annotation.id}-label-bg`}
                  x={box.x}
                  y={labelY}
                  width={labelWidth}
                  height={22}
                  fill={annotation.id === selectedAnnotationId ? "#f8fafc" : color}
                  cornerRadius={3}
                  listening={false}
                />
                <Text
                  key={`${annotation.id}-label`}
                  x={box.x + 5}
                  y={labelY + 4}
                  text={label}
                  fontSize={12}
                  fontStyle="bold"
                  fill={annotation.id === selectedAnnotationId ? "#0d141f" : "#ffffff"}
                  listening={false}
                />
              </Fragment>
            );
          })}
          {draftBox ? (
            <Rect
              x={draftBox.x}
              y={draftBox.y}
              width={draftBox.width}
              height={draftBox.height}
              stroke={selectedClass.color}
              strokeWidth={2}
              dash={[6, 4]}
            />
          ) : null}
          {isDrawingROI && roiDraft && roiDraft.length > 0 ? (
            <Line
              points={roiDraft.flatMap((p) => [p.x * canvasSize.width, p.y * canvasSize.height])}
              closed={false}
              stroke="red"
              strokeWidth={2}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}
