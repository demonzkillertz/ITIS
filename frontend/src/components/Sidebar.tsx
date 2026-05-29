import { CircleDot, ListChecks, Trash2 } from "lucide-react";

import type { Annotation, AnnotationClass } from "../types";

type SidebarProps = {
  classes: AnnotationClass[];
  selectedClass: AnnotationClass;
  onSelectClass: (annotationClass: AnnotationClass) => void;
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string) => void;
  onDeleteAnnotation: (id: string) => void;
};

export default function Sidebar({
  classes,
  selectedClass,
  onSelectClass,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onDeleteAnnotation
}: SidebarProps) {
  return (
    <aside className="left-panel">
      <div className="panel-heading">
        <CircleDot size={18} />
        <h2>Classes</h2>
      </div>
      <div className="class-list">
        {classes.map((annotationClass) => {
          const isSelected =
            annotationClass.id === selectedClass.id && annotationClass.task === selectedClass.task;
          return (
            <button
              key={`${annotationClass.task}-${annotationClass.id}`}
              className={isSelected ? "class-button active" : "class-button"}
              onClick={() => onSelectClass(annotationClass)}
            >
              <span style={{ backgroundColor: annotationClass.color }} />
              {annotationClass.name}
            </button>
          );
        })}
      </div>

      <div className="panel-heading annotation-heading">
        <ListChecks size={18} />
        <h2>Labels</h2>
      </div>
      <div className="annotation-list">
        {annotations.map((annotation) => (
          <div
            key={annotation.id}
            className={
              annotation.id === selectedAnnotationId ? "annotation-row active" : "annotation-row"
            }
          >
            <button className="annotation-select" onClick={() => onSelectAnnotation(annotation.id)}>
              <span>{annotation.className}</span>
              <small>
                {annotation.isPrefetched ? "prefetch" : annotation.source} / {annotation.status}
              </small>
            </button>
            <button
              className="annotation-delete"
              title={`Delete ${annotation.className}`}
              onClick={() => onDeleteAnnotation(annotation.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {annotations.length === 0 ? <p className="empty-state">No labels</p> : null}
      </div>
    </aside>
  );
}
