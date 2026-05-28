import { Check, ChevronLeft, ChevronRight, ImagePlus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ensureDataset,
  importServerFolder,
  listImportHistory,
  listAnnotations,
  listMedia,
  saveAnnotations,
  uploadImages
} from "./api";
import AnnotationCanvas from "./components/AnnotationCanvas";
import Sidebar from "./components/Sidebar";
import { classes } from "./data/sample";
import type { ImportHistoryItem } from "./api";
import type { Annotation, AnnotationClass, MediaSample } from "./types";

export default function App() {
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("Loading dataset");
  const [mediaItems, setMediaItems] = useState<MediaSample[]>([]);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [confidence, setConfidence] = useState(0.45);
  const [selectedClass, setSelectedClass] = useState<AnnotationClass>(classes[1]);
  const [annotationsByMedia, setAnnotationsByMedia] = useState<Record<string, Annotation[]>>({});
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting to API");
  const [isSaving, setIsSaving] = useState(false);
  const [parentDir, setParentDir] = useState("");
  const [imageDir, setImageDir] = useState("");
  const [labelDir, setLabelDir] = useState("");
  const [importTask, setImportTask] = useState<"vehicle" | "plate">("vehicle");
  const [importMode, setImportMode] = useState<"auto" | "explicit">("auto");
  const [duplicatePolicy, setDuplicatePolicy] = useState<"skip" | "import_copy">("skip");
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);

  const media = mediaItems[mediaIndex] ?? null;
  const mediaId = media?.id ?? null;
  const annotations = useMemo(
    () => (mediaId ? annotationsByMedia[mediaId] ?? [] : []),
    [annotationsByMedia, mediaId]
  );
  const visibleAnnotations = annotations.filter(
    (annotation) => annotation.source !== "model" || (annotation.confidence ?? 1) >= confidence
  );

  useEffect(() => {
    let active = true;
    ensureDataset()
      .then(async (dataset) => {
        if (!active) {
          return;
        }
        setDatasetId(dataset.id);
        setDatasetName(dataset.name);
        const media = await listMedia(dataset.id);
        const history = await listImportHistory(dataset.id);
        if (active) {
          setMediaItems(media);
          setImportHistory(history);
          setStatus(media.length ? "Ready" : "Upload images to start annotation");
        }
      })
      .catch((error) => setStatus(error.message));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!media || annotationsByMedia[media.id]) {
      return;
    }
    const currentMediaId = media.id;
    listAnnotations(media.id)
      .then((items) => {
        setAnnotationsByMedia((current) => ({ ...current, [currentMediaId]: items }));
      })
      .catch((error) => setStatus(error.message));
  }, [annotationsByMedia, media]);

  function replaceAnnotations(nextAnnotations: Annotation[]) {
    if (!media) {
      return;
    }
    setAnnotationsByMedia((current) => ({
      ...current,
      [media.id]: nextAnnotations
    }));
  }

  function updateAnnotation(nextAnnotation: Annotation) {
    replaceAnnotations(
      annotations.map((annotation) =>
        annotation.id === nextAnnotation.id ? nextAnnotation : annotation
      )
    );
  }

  function addAnnotation(annotation: Annotation) {
    replaceAnnotations([...annotations, annotation]);
    setSelectedAnnotationId(annotation.id);
  }

  function deleteSelected() {
    if (!selectedAnnotationId) {
      return;
    }
    replaceAnnotations(annotations.filter((annotation) => annotation.id !== selectedAnnotationId));
    setSelectedAnnotationId(null);
  }

  function acceptSelected() {
    if (!selectedAnnotationId) {
      return;
    }
    replaceAnnotations(
      annotations.map((annotation) =>
        annotation.id === selectedAnnotationId
          ? { ...annotation, status: "accepted", source: "manual" }
          : annotation
      )
    );
  }

  function goTo(delta: number) {
    setMediaIndex((current) => Math.min(mediaItems.length - 1, Math.max(0, current + delta)));
    setSelectedAnnotationId(null);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !datasetId) {
      return;
    }
    setStatus("Uploading images");
    try {
      const uploaded = await uploadImages(datasetId, files);
      const nextMedia = [...mediaItems, ...uploaded];
      setMediaItems(nextMedia);
      setMediaIndex(Math.max(0, nextMedia.length - uploaded.length));
      setStatus(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function handleSave() {
    if (!media) {
      return;
    }
    setIsSaving(true);
    setStatus("Saving annotations");
    try {
      const saved = await saveAnnotations(media.id, annotations);
      setAnnotationsByMedia((current) => ({ ...current, [media.id]: saved }));
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleServerImport() {
    if (!datasetId) {
      return;
    }
    if (importMode === "auto" && !parentDir.trim() && !imageDir.trim()) {
      setStatus("Enter a parent folder or image folder path");
      return;
    }
    if (importMode === "explicit" && !imageDir.trim()) {
      setStatus("Enter an image folder path");
      return;
    }
    setStatus("Importing server folder");
    try {
      const result = await importServerFolder(
        datasetId,
        parentDir.trim(),
        imageDir.trim(),
        labelDir.trim(),
        importTask,
        importMode,
        duplicatePolicy
      );
      const refreshed = await listMedia(datasetId);
      const history = await listImportHistory(datasetId);
      setMediaItems(refreshed);
      setImportHistory(history);
      setAnnotationsByMedia({});
      setMediaIndex(Math.max(0, refreshed.length - result.media.length));
      setSelectedAnnotationId(null);
      setStatus(
        `Imported ${result.importedImages} images and ${result.importedAnnotations} labels${
          result.issueCount ? `, ${result.issueCount} issues` : ""
        }`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Server folder import failed");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">ITIS</span>
          <h1>{datasetName}</h1>
        </div>
        <div className="toolbar" aria-label="Annotation commands">
          <button title="Previous frame" onClick={() => goTo(-1)} disabled={mediaIndex === 0}>
            <ChevronLeft size={18} />
          </button>
          <span className="frame-counter">
            {mediaItems.length ? mediaIndex + 1 : 0} / {mediaItems.length}
          </span>
          <button
            title="Next frame"
            onClick={() => goTo(1)}
            disabled={mediaIndex === mediaItems.length - 1 || mediaItems.length === 0}
          >
            <ChevronRight size={18} />
          </button>
          <button title="Accept selected annotation" onClick={acceptSelected}>
            <Check size={18} />
          </button>
          <button title="Delete selected annotation" onClick={deleteSelected}>
            <Trash2 size={18} />
          </button>
          <button title="Save annotations" onClick={handleSave} disabled={!media || isSaving}>
            <Save size={18} />
          </button>
          <label className="upload-button" title="Upload images">
            <ImagePlus size={18} />
            <input
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              multiple
              onChange={(event) => handleUpload(event.target.files)}
            />
          </label>
        </div>
      </header>

      <main className="workspace">
        <Sidebar
          classes={classes}
          selectedClass={selectedClass}
          onSelectClass={setSelectedClass}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          onSelectAnnotation={setSelectedAnnotationId}
        />

        <section className="canvas-column" aria-label="Annotation canvas">
          <div className="media-meta">
            <strong>{media ? media.fileName : "No image selected"}</strong>
            <span>
              {status}
              {media && typeof media.timestampSeconds === "number"
                ? ` at ${media.timestampSeconds.toFixed(1)}s`
                : ""}
            </span>
          </div>
          {media ? (
            <AnnotationCanvas
              media={media}
              annotations={visibleAnnotations}
              selectedAnnotationId={selectedAnnotationId}
              selectedClass={selectedClass}
              onAddAnnotation={addAnnotation}
              onSelectAnnotation={setSelectedAnnotationId}
              onUpdateAnnotation={updateAnnotation}
            />
          ) : (
            <div className="empty-canvas">
              <ImagePlus size={32} />
              <span>Upload traffic images to begin</span>
            </div>
          )}
        </section>

        <aside className="review-panel" aria-label="Review controls">
          <div className="panel-heading">
            <SlidersHorizontal size={18} />
            <h2>Review</h2>
          </div>
          <div className="folder-import">
            <label>
              <span>Import mode</span>
              <select
                value={importMode}
                onChange={(event) => setImportMode(event.target.value as "auto" | "explicit")}
              >
                <option value="auto">Parent folder or auto</option>
                <option value="explicit">Separate folders</option>
              </select>
            </label>
            <label>
              <span>Parent folder</span>
              <input
                type="text"
                value={parentDir}
                onChange={(event) => setParentDir(event.target.value)}
                placeholder="C:\\datasets\\traffic"
              />
            </label>
            <label>
              <span>Image folder</span>
              <input
                type="text"
                value={imageDir}
                onChange={(event) => setImageDir(event.target.value)}
                placeholder="C:\\datasets\\traffic\\images"
              />
            </label>
            <label>
              <span>Label folder</span>
              <input
                type="text"
                value={labelDir}
                onChange={(event) => setLabelDir(event.target.value)}
                placeholder="C:\\datasets\\traffic\\labels"
              />
            </label>
            <label>
              <span>Label task</span>
              <select
                value={importTask}
                onChange={(event) => setImportTask(event.target.value as "vehicle" | "plate")}
              >
                <option value="vehicle">Vehicle</option>
                <option value="plate">Number plate</option>
              </select>
            </label>
            <label>
              <span>Duplicates</span>
              <select
                value={duplicatePolicy}
                onChange={(event) =>
                  setDuplicatePolicy(event.target.value as "skip" | "import_copy")
                }
              >
                <option value="skip">Skip existing names</option>
                <option value="import_copy">Import as copies</option>
              </select>
            </label>
            <button onClick={handleServerImport}>Import</button>
          </div>
          <div className="import-history">
            <h3>Import History</h3>
            {importHistory.slice(0, 5).map((item) => (
              <div className="history-row" key={item.id}>
                <strong>{item.importedImages} images</strong>
                <span>
                  {item.importedAnnotations} labels, {item.skippedImages} skipped
                </span>
                <small>{item.imageDir}</small>
              </div>
            ))}
            {importHistory.length === 0 ? <p>No imports yet</p> : null}
          </div>
          <label className="range-field">
            <span>Confidence</span>
            <strong>{Math.round(confidence * 100)}%</strong>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={confidence}
              onChange={(event) => setConfidence(Number(event.target.value))}
            />
          </label>
          <dl className="stats">
            <div>
              <dt>Total</dt>
              <dd>{annotations.length}</dd>
            </div>
            <div>
              <dt>Visible</dt>
              <dd>{visibleAnnotations.length}</dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>{annotations.filter((item) => item.status === "accepted").length}</dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}
