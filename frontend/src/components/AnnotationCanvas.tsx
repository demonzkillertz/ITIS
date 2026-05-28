import { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";

import type { Annotation, AnnotationClass, Box, MediaSample } from "../types";

type CanvasProps = {
  media: MediaSample;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  selectedClass: AnnotationClass;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (annotation: Annotation) => void;
};

type PixelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function useImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const nextImage = new window.Image();
    nextImage.crossOrigin = "anonymous";
    nextImage.src = url;
    nextImage.onload = () => setImage(nextImage);
  }, [url]);

  return image;
}

function toPixelBox(box: Box, width: number, height: number): PixelBox {
  return {
    x: (box.xCenter - box.width / 2) * width,
    y: (box.yCenter - box.height / 2) * height,
    width: box.width * width,
    height: box.height * height
  };
}

function toNormalizedBox(box: PixelBox, width: number, height: number): Box {
  return {
    xCenter: (box.x + box.width / 2) / width,
    yCenter: (box.y + box.height / 2) / height,
    width: box.width / width,
    height: box.height / height
  };
}

export default function AnnotationCanvas({
  media,
  annotations,
  selectedAnnotationId,
  selectedClass,
  onAddAnnotation,
  onSelectAnnotation,
  onUpdateAnnotation
}: CanvasProps) {
  const image = useImage(media.imageUrl);
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

  const canvasSize = useMemo(() => {
    const maxHeight = 720;
    const scale = Math.min(containerWidth / media.width, maxHeight / media.height);
    return {
      width: Math.round(media.width * scale),
      height: Math.round(media.height * scale),
      scale
    };
  }, [containerWidth, media.height, media.width]);

  function pointerPosition(event: { target: { getStage: () => any } }) {
    const stage = event.target.getStage();
    return stage?.getPointerPosition() ?? { x: 0, y: 0 };
  }

  function startDrawing(event: any) {
    const stage = event.target.getStage();
    const targetClass = event.target.getClassName?.();
    if (event.target !== stage && targetClass !== "Image") {
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
        onMouseMove={continueDrawing}
        onMouseUp={finishDrawing}
      >
        <Layer>
          {image ? (
            <KonvaImage image={image} width={canvasSize.width} height={canvasSize.height} />
          ) : (
            <Rect width={canvasSize.width} height={canvasSize.height} fill="#17202a" />
          )}
        </Layer>
        <Layer>
          {annotations.map((annotation) => {
            const box = toPixelBox(annotation.box, canvasSize.width, canvasSize.height);
            const color = annotation.task === "plate" ? "#0f766e" : "#d95836";
            const selected = annotation.id === selectedAnnotationId;
            return (
              <Rect
                key={annotation.id}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                stroke={selected ? "#f8fafc" : color}
                strokeWidth={selected ? 3 : 2}
                dash={annotation.status === "draft" ? [8, 5] : undefined}
                draggable
                onClick={() => onSelectAnnotation(annotation.id)}
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
          {annotations.map((annotation) => {
            const box = toPixelBox(annotation.box, canvasSize.width, canvasSize.height);
            return (
              <Text
                key={`${annotation.id}-label`}
                x={box.x}
                y={Math.max(0, box.y - 20)}
                text={annotation.className}
                fontSize={13}
                fill="#ffffff"
                padding={4}
                listening={false}
              />
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
        </Layer>
      </Stage>
    </div>
  );
}
