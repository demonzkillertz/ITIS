import { Check, CircleDot, ListChecks, Trash2 } from "lucide-react";
import { useMemo } from "react";

import type { Annotation, AnnotationClass } from "../types";

type SidebarProps = {
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string) => void;
  onAcceptAnnotation: (id: string) => void;
  onDeleteAnnotation: (id: string) => void;
};

export default function Sidebar({
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onAcceptAnnotation,
  onDeleteAnnotation
}: SidebarProps) {
  const annotationIndices = useMemo(() => {
    const indices: Record<string, number> = {};
    const result: Record<string, number> = {};
    annotations.forEach((ann) => {
      const current = indices[ann.className] || 0;
      indices[ann.className] = current + 1;
      result[ann.id] = indices[ann.className];
    });
    return result;
  }, [annotations]);

  return (
    <aside className="left-panel">
      <div className="panel-heading annotation-heading">
        <ListChecks size={18} />
        <h2>Labels</h2>
      </div>
      <div className="annotation-list">
        {annotations.filter(a => a.classId !== 10).map((annotation) => {
          const index = annotationIndices[annotation.id];
          const labelText = `${index} ${annotation.className}`;
          return (
            <div
              key={annotation.id}
              className={
                annotation.id === selectedAnnotationId ? "annotation-row active" : "annotation-row"
              }
            >
              <button className="annotation-select" onClick={() => onSelectAnnotation(annotation.id)}>
                <span title={labelText}>{labelText}</span>
                <small>
                {annotation.isPrefetched ? "prefetch" : annotation.source} / {annotation.status}
              </small>
            </button>
            <button
              className="annotation-verify"
              title={`Verify ${annotation.className}`}
              onClick={() => onAcceptAnnotation(annotation.id)}
              disabled={annotation.status === "accepted" && Boolean(annotation.verifiedAt)}
            >
              <Check size={15} />
            </button>
            <button
              className="annotation-delete"
              title={`Delete ${annotation.className}`}
              onClick={() => onDeleteAnnotation(annotation.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )})}
        {annotations.length === 0 ? <p className="empty-state">No labels</p> : null}
      </div>
    </aside>
  );
}
