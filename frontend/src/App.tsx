import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderSearch,
  GalleryHorizontalEnd,
  ImagePlus,
  ListChecks,
  Save,
  Trash2,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ensureDataset,
  importImageFolder,
  importServerFolder,
  importVideoFolder,
  listAnnotations,
  listImportHistory,
  listMedia,
  saveAnnotations,
  scanImageFolder,
  scanServerFolder,
  scanVideoFolder,
  uploadImages
} from "./api";
import AnnotationCanvas from "./components/AnnotationCanvas";
import Sidebar from "./components/Sidebar";
import { classes } from "./data/sample";
import type { ImportHistoryItem } from "./api";
import type { Annotation, AnnotationClass, MediaSample } from "./types";

type ScanResult = Awaited<ReturnType<typeof scanServerFolder>>;

export default function App() {
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("Traffic Annotation Dataset");
  const [mediaItems, setMediaItems] = useState<MediaSample[]>([]);
  const [screen, setScreen] = useState<"home" | "annotate">("home");
  const [activeTab, setActiveTab] = useState<"dashboard" | "images" | "videos" | "media" | "history">("dashboard");
  const [mediaIndex, setMediaIndex] = useState(0);
  const [selectedClass, setSelectedClass] = useState<AnnotationClass>(classes[1]);
  const [annotationsByMedia, setAnnotationsByMedia] = useState<Record<string, Annotation[]>>({});
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isSaving, setIsSaving] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [parentDir, setParentDir] = useState("");
  const [imageDir, setImageDir] = useState("");
  const [videoDir, setVideoDir] = useState("");
  const [labelDir, setLabelDir] = useState("");
  const [importTask, setImportTask] = useState<"vehicle" | "plate">("vehicle");
  const [importMode, setImportMode] = useState<"auto" | "explicit">("auto");
  const [duplicatePolicy, setDuplicatePolicy] = useState<"skip" | "import_copy">("skip");
  const [importImages, setImportImages] = useState(true);
  const [importVideos, setImportVideos] = useState(false);
  const [extractVideoFrames, setExtractVideoFrames] = useState(true);
  const [autoAnnotate, setAutoAnnotate] = useState(false);
  const [sampleEverySeconds, setSampleEverySeconds] = useState(1);

  const annotatableMedia = useMemo(
    () => mediaItems.filter((item) => item.mediaType === "image"),
    [mediaItems]
  );
  const videoCount = mediaItems.filter((item) => item.mediaType === "video").length;
  const media = annotatableMedia[mediaIndex] ?? null;
  const mediaId = media?.id ?? null;
  const annotations = useMemo(
    () => (mediaId ? annotationsByMedia[mediaId] ?? [] : []),
    [annotationsByMedia, mediaId]
  );

  useEffect(() => {
    let active = true;
    ensureDataset()
      .then(async (dataset) => {
        const [media, history] = await Promise.all([
          listMedia(dataset.id),
          listImportHistory(dataset.id)
        ]);
        if (!active) {
          return;
        }
        setDatasetId(dataset.id);
        setDatasetName(dataset.name);
        setMediaItems(media);
        setImportHistory(history);
        setStatus(media.length ? "Dataset loaded" : "No imported media");
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

  function importPayloadIsValid() {
    if (!importImages && !importVideos) {
      setStatus("Choose images, videos, or both");
      return false;
    }
    if (importMode === "auto" && !parentDir.trim() && !imageDir.trim() && !videoDir.trim()) {
      setStatus("Enter a parent, image, or video folder path");
      return false;
    }
    if (importMode === "explicit" && importImages && !imageDir.trim()) {
      setStatus("Enter an image folder path");
      return false;
    }
    if (importMode === "explicit" && importVideos && !videoDir.trim()) {
      setStatus("Enter a video folder path");
      return false;
    }
    return true;
  }

  async function refreshDataset(nextDatasetId = datasetId) {
    if (!nextDatasetId) {
      return;
    }
    const [media, history] = await Promise.all([
      listMedia(nextDatasetId),
      listImportHistory(nextDatasetId)
    ]);
    setMediaItems(media);
    setImportHistory(history);
  }

  async function handleScan() {
    if (!datasetId || !importPayloadIsValid()) {
      return;
    }
    setStatus("Scanning server folders");
    try {
      const result =
        activeTab === "images"
          ? await scanImageFolder(
              datasetId,
              parentDir,
              imageDir,
              labelDir,
              importTask,
              importMode,
              duplicatePolicy,
              autoAnnotate
            )
          : activeTab === "videos"
            ? await scanVideoFolder(
                datasetId,
                parentDir,
                videoDir,
                importTask,
                importMode,
                duplicatePolicy,
                extractVideoFrames,
                sampleEverySeconds,
                autoAnnotate
              )
            : await scanServerFolder(
                datasetId,
                parentDir,
                imageDir,
                videoDir,
                labelDir,
                importTask,
                importMode,
                duplicatePolicy,
                importImages,
                importVideos,
                extractVideoFrames,
                sampleEverySeconds,
                autoAnnotate
              );
      setScanResult(result);
      setStatus(
        `Found ${result.image_count} images, ${result.video_count} videos, ${result.matched_label_count} matching labels`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan failed");
    }
  }

  async function handleServerImport() {
    if (!datasetId || !importPayloadIsValid()) {
      return;
    }
    setStatus("Importing from server folders");
    try {
      const result =
        activeTab === "images"
          ? await importImageFolder(
              datasetId,
              parentDir,
              imageDir,
              labelDir,
              importTask,
              importMode,
              duplicatePolicy,
              autoAnnotate
            )
          : activeTab === "videos"
            ? await importVideoFolder(
                datasetId,
                parentDir,
                videoDir,
                importTask,
                importMode,
                duplicatePolicy,
                extractVideoFrames,
                sampleEverySeconds,
                autoAnnotate
              )
            : await importServerFolder(
                datasetId,
                parentDir,
                imageDir,
                videoDir,
                labelDir,
                importTask,
                importMode,
                duplicatePolicy,
                importImages,
                importVideos,
                extractVideoFrames,
                sampleEverySeconds,
                autoAnnotate
              );
      await refreshDataset(datasetId);
      setAnnotationsByMedia({});
      setScanResult(null);
      setStatus(
        `Imported ${result.importedImages} images, ${result.importedVideos} videos, ${result.importedFrames} frames`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed");
    }
  }

  function openImageImport() {
    setImportImages(true);
    setImportVideos(false);
    setExtractVideoFrames(false);
    setActiveTab("images");
  }

  function openVideoImport() {
    setImportImages(false);
    setImportVideos(true);
    setExtractVideoFrames(true);
    setActiveTab("videos");
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !datasetId) {
      return;
    }
    setStatus("Uploading images");
    try {
      await uploadImages(datasetId, files);
      await refreshDataset(datasetId);
      setStatus(`${files.length} image${files.length === 1 ? "" : "s"} uploaded`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    }
  }

  function openMedia(index: number) {
    setMediaIndex(index);
    setSelectedAnnotationId(null);
    setScreen("annotate");
  }

  function goTo(delta: number) {
    setMediaIndex((current) =>
      Math.min(annotatableMedia.length - 1, Math.max(0, current + delta))
    );
    setSelectedAnnotationId(null);
  }

  function replaceAnnotations(nextAnnotations: Annotation[]) {
    if (!media) {
      return;
    }
    setAnnotationsByMedia((current) => ({ ...current, [media.id]: nextAnnotations }));
  }

  function addAnnotation(annotation: Annotation) {
    replaceAnnotations([
      ...annotations,
      {
        ...annotation,
        reviewedByUser: "local_user",
        verifiedAt: new Date().toISOString()
      }
    ]);
    setSelectedAnnotationId(annotation.id);
  }

  function updateAnnotation(nextAnnotation: Annotation) {
    replaceAnnotations(
      annotations.map((annotation) =>
        annotation.id === nextAnnotation.id ? nextAnnotation : annotation
      )
    );
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
          ? {
              ...annotation,
              status: "accepted",
              reviewedByUser: "local_user",
              verifiedAt: new Date().toISOString()
            }
          : annotation
      )
    );
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
      setStatus("Annotations saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  if (screen === "annotate") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">ITIS</span>
            <h1>{media ? media.fileName : datasetName}</h1>
          </div>
          <div className="toolbar">
            <button title="Back to gallery" onClick={() => setScreen("home")}>
              <ArrowLeft size={18} />
            </button>
            <button title="Previous image" onClick={() => goTo(-1)} disabled={mediaIndex === 0}>
              <ChevronLeft size={18} />
            </button>
            <span className="frame-counter">
              {annotatableMedia.length ? mediaIndex + 1 : 0} / {annotatableMedia.length}
            </span>
            <button
              title="Next image"
              onClick={() => goTo(1)}
              disabled={mediaIndex === annotatableMedia.length - 1 || annotatableMedia.length === 0}
            >
              <ChevronRight size={18} />
            </button>
            <button title="Accept selected" onClick={acceptSelected}>
              <Check size={18} />
            </button>
            <button title="Delete selected" onClick={deleteSelected}>
              <Trash2 size={18} />
            </button>
            <button title="Save annotations" onClick={handleSave} disabled={!media || isSaving}>
              <Save size={18} />
            </button>
          </div>
        </header>

        <main className="annotation-layout">
          <Sidebar
            classes={classes}
            selectedClass={selectedClass}
            onSelectClass={setSelectedClass}
            annotations={annotations}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={setSelectedAnnotationId}
          />
          <section className="annotation-stage">
            <div className="media-meta">
              <strong>{status}</strong>
              <span>
                {media && typeof media.timestampSeconds === "number"
                  ? `${media.timestampSeconds.toFixed(1)}s`
                  : ""}
              </span>
            </div>
            {media ? (
              <AnnotationCanvas
                media={media}
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                selectedClass={selectedClass}
                onAddAnnotation={addAnnotation}
                onSelectAnnotation={setSelectedAnnotationId}
                onUpdateAnnotation={updateAnnotation}
              />
            ) : (
              <div className="empty-canvas">No image selected</div>
            )}
          </section>
          <aside className="review-panel annotation-review">
            <div className="metric-row">
              <span>Total</span>
              <strong>{annotations.length}</strong>
            </div>
            <div className="metric-row">
              <span>AI draft</span>
              <strong>
                {annotations.filter((item) => item.source === "model" && item.status === "draft").length}
              </strong>
            </div>
            <div className="metric-row">
              <span>Prefetch</span>
              <strong>{annotations.filter((item) => item.isPrefetched).length}</strong>
            </div>
            <div className="metric-row">
              <span>Verified</span>
              <strong>{annotations.filter((item) => item.verifiedAt).length}</strong>
            </div>
          </aside>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell home-shell">
      <header className="topbar home-topbar">
        <div>
          <span className="eyebrow">ITIS</span>
          <h1>{datasetName}</h1>
        </div>
        <div className="toolbar">
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

      <main className="home-layout">
        <nav className="dashboard-tabs" aria-label="Dashboard sections">
          <button className={activeTab === "dashboard" ? "active" : ""} onClick={() => setActiveTab("dashboard")}>
            <BarChart3 size={17} />
            Dashboard
          </button>
          <button className={activeTab === "images" ? "active" : ""} onClick={openImageImport}>
            <ImagePlus size={17} />
            Image Import
          </button>
          <button className={activeTab === "videos" ? "active" : ""} onClick={openVideoImport}>
            <Film size={17} />
            Video Frames
          </button>
          <button className={activeTab === "media" ? "active" : ""} onClick={() => setActiveTab("media")}>
            <GalleryHorizontalEnd size={17} />
            Media
          </button>
          <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
            <ListChecks size={17} />
            History
          </button>
        </nav>

        {activeTab === "dashboard" ? (
          <section className="dashboard-surface">
            <div className="section-title">
              <BarChart3 size={20} />
              <h2>Dashboard</h2>
            </div>
            <div className="dashboard-hero">
              <button onClick={openImageImport}>
                <ImagePlus size={22} />
                <strong>Import Existing Images</strong>
                <span>Scan server image folders and optional YOLO labels.</span>
              </button>
              <button onClick={openVideoImport}>
                <Film size={22} />
                <strong>Scan Videos</strong>
                <span>Import videos, extract frames, and create AI suggestions.</span>
              </button>
              <button onClick={() => setActiveTab("media")}>
                <GalleryHorizontalEnd size={22} />
                <strong>Open Gallery</strong>
                <span>Review imported images and extracted frames.</span>
              </button>
            </div>
            <div className="home-stats dashboard-stats">
              <div>
                <span>Images/frames</span>
                <strong>{annotatableMedia.length}</strong>
              </div>
              <div>
                <span>Videos</span>
                <strong>{videoCount}</strong>
              </div>
              <div>
                <span>Imports</span>
                <strong>{importHistory.length}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{status}</strong>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "images" || activeTab === "videos" ? (
          <section className="import-surface">
            <div className="section-title">
              {activeTab === "images" ? <ImagePlus size={20} /> : <Film size={20} />}
              <h2>{activeTab === "images" ? "Existing Image Import" : "Video Scan and Frame Extraction"}</h2>
            </div>
            <div className="workflow-note">
              {activeTab === "images"
                ? "Use this for completed, partial, or unlabeled image datasets. Labels are matched by image filename stem."
                : "Use this for traffic videos. The backend copies videos, extracts sampled frames, and can create AI draft boxes."}
            </div>
            <div className="import-grid">
              <label>
                <span>Mode</span>
                <select
                  value={importMode}
                  onChange={(event) => setImportMode(event.target.value as "auto" | "explicit")}
                >
                  <option value="auto">Parent folder</option>
                  <option value="explicit">Separate folders</option>
                </select>
              </label>
              <label>
                <span>Parent folder</span>
                <input
                  value={parentDir}
                  onChange={(event) => setParentDir(event.target.value)}
                  placeholder="C:\\datasets\\traffic"
                />
              </label>
              {activeTab === "images" ? (
                <>
                  <label>
                    <span>Images</span>
                    <input
                      value={imageDir}
                      onChange={(event) => setImageDir(event.target.value)}
                      placeholder="C:\\datasets\\traffic\\images"
                    />
                  </label>
                  <label>
                    <span>Labels</span>
                    <input
                      value={labelDir}
                      onChange={(event) => setLabelDir(event.target.value)}
                      placeholder="C:\\datasets\\traffic\\labels"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>Videos</span>
                    <input
                      value={videoDir}
                      onChange={(event) => setVideoDir(event.target.value)}
                      placeholder="C:\\datasets\\traffic\\videos"
                    />
                  </label>
                  <label>
                    <span>Frame sample seconds</span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={sampleEverySeconds}
                      onChange={(event) => setSampleEverySeconds(Number(event.target.value))}
                    />
                  </label>
                </>
              )}
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
                  <option value="skip">Skip existing</option>
                  <option value="import_copy">Import copies</option>
                </select>
              </label>
            </div>

            <div className="option-strip">
              {activeTab === "videos" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={extractVideoFrames}
                    onChange={(event) => setExtractVideoFrames(event.target.checked)}
                  />
                  Extract frames
                </label>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={autoAnnotate}
                  onChange={(event) => setAutoAnnotate(event.target.checked)}
                />
                AI suggestions
              </label>
            </div>

            <div className="action-row">
              <button onClick={handleScan}>
                <FolderSearch size={17} />
                Scan
              </button>
              <button onClick={handleServerImport}>
                <Wand2 size={17} />
                Import
              </button>
              <span>{status}</span>
            </div>

            {scanResult ? (
              <div className="scan-summary">
                <div>
                  <span>Images</span>
                  <strong>{scanResult.image_count}</strong>
                </div>
                <div>
                  <span>Videos</span>
                  <strong>{scanResult.video_count}</strong>
                </div>
                <div>
                  <span>Labels</span>
                  <strong>{scanResult.label_count}</strong>
                </div>
                <div>
                  <span>Matched</span>
                  <strong>{scanResult.matched_label_count}</strong>
                </div>
                <div>
                  <span>Missing</span>
                  <strong>{scanResult.missing_label_count}</strong>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "media" ? (
          <section className="gallery-surface">
            <div className="section-title">
              <GalleryHorizontalEnd size={20} />
              <h2>Imported Media Gallery</h2>
            </div>
            <div className="home-stats">
              <div>
                <span>Images/frames</span>
                <strong>{annotatableMedia.length}</strong>
              </div>
              <div>
                <span>Videos</span>
                <strong>{videoCount}</strong>
              </div>
              <div>
                <span>Imports</span>
                <strong>{importHistory.length}</strong>
              </div>
            </div>
            <div className="gallery-grid home-gallery">
              {annotatableMedia.map((item, index) => (
                <button className="gallery-tile" key={item.id} onClick={() => openMedia(index)}>
                  <img src={item.imageUrl} alt={item.fileName} />
                  <span>{item.fileName}</span>
                  {typeof item.frameIndex === "number" ? <small>Frame {item.frameIndex}</small> : null}
                </button>
              ))}
              {annotatableMedia.length === 0 ? (
                <div className="empty-gallery">No imported images or frames</div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "history" ? (
          <section className="history-surface full-history">
            <h2>Import History</h2>
            {importHistory.map((item) => (
              <div className="history-row" key={item.id}>
                <strong>
                  {item.importedImages} images, {item.importedVideos} videos
                </strong>
                <span>
                  {item.importedFrames} frames, {item.importedAnnotations} labels,{" "}
                  {item.modelAnnotations} AI
                </span>
                <small>{item.imageDir || item.videoDir || item.parentDir}</small>
              </div>
            ))}
            {importHistory.length === 0 ? <p>No imports yet</p> : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
