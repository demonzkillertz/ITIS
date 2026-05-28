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
  autoAnnotateMedia,
  downloadModels,
  ensureDataset,
  extractFrames,
  importImageFolder,
  importServerFolder,
  importVideoFolder,
  listAnnotations,
  listImportHistory,
  listMedia,
  listModels,
  saveAnnotations,
  scanImageFolder,
  scanServerFolder,
  scanVideoFolder,
  uploadImages
} from "./api";
import AnnotationCanvas from "./components/AnnotationCanvas";
import Sidebar from "./components/Sidebar";
import { classes } from "./data/sample";
import type { ImportHistoryItem, ModelOption } from "./api";
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
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
  const [vehicleModelKey, setVehicleModelKey] = useState("custom_vehicle");
  const [plateModelKey, setPlateModelKey] = useState("custom_plate");

  const annotatableMedia = useMemo(
    () => mediaItems.filter((item) => item.mediaType === "image"),
    [mediaItems]
  );
  const videos = useMemo(() => mediaItems.filter((item) => item.mediaType === "video"), [mediaItems]);
  const videoCount = videos.length;
  const media = annotatableMedia[mediaIndex] ?? null;
  const mediaId = media?.id ?? null;
  const annotations = useMemo(
    () => (mediaId ? annotationsByMedia[mediaId] ?? [] : []),
    [annotationsByMedia, mediaId]
  );
  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId]
  );

  useEffect(() => {
    let active = true;
    ensureDataset()
      .then(async (dataset) => {
        const [media, history] = await Promise.all([
          listMedia(dataset.id),
          listImportHistory(dataset.id)
        ]);
        const catalog = await listModels();
        if (!active) {
          return;
        }
        setDatasetId(dataset.id);
        setDatasetName(dataset.name);
        setMediaItems(media);
        setImportHistory(history);
        setModelOptions(catalog.models);
        setVehicleModelKey(catalog.vehicleDefault);
        setPlateModelKey(catalog.plateDefault);
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

  async function runWithProgress(label: string, action: () => Promise<void>) {
    setIsProcessing(true);
    setProcessingLabel(label);
    setStatus(label);
    try {
      await action();
    } finally {
      setIsProcessing(false);
      setProcessingLabel(null);
    }
  }

  async function handleScan() {
    if (!datasetId || !importPayloadIsValid()) {
      return;
    }
    await runWithProgress("Scanning server folders", async () => {
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
              autoAnnotate,
              vehicleModelKey,
              plateModelKey
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
                autoAnnotate,
                vehicleModelKey,
                plateModelKey
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
                autoAnnotate,
                vehicleModelKey,
                plateModelKey
              );
      setScanResult(result);
      setStatus(
        `Found ${result.image_count} images, ${result.video_count} videos, ${result.matched_label_count} matching labels`
      );
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Scan failed"));
  }

  async function handleServerImport() {
    if (!datasetId || !importPayloadIsValid()) {
      return;
    }
    await runWithProgress("Importing from server folders", async () => {
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
              autoAnnotate,
              vehicleModelKey,
              plateModelKey
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
                autoAnnotate,
                vehicleModelKey,
                plateModelKey
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
                autoAnnotate,
                vehicleModelKey,
                plateModelKey
              );
      await refreshDataset(datasetId);
      setAnnotationsByMedia({});
      setScanResult(null);
      setActiveTab("media");
      setStatus(
        `Imported ${result.importedImages} images, ${result.importedVideos} videos, ${result.importedFrames} frames`
      );
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Import failed"));
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
    await runWithProgress("Uploading images", async () => {
      await uploadImages(datasetId, files);
      await refreshDataset(datasetId);
      setActiveTab("media");
      setStatus(`${files.length} image${files.length === 1 ? "" : "s"} uploaded`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Upload failed"));
  }

  function openMedia(index: number) {
    setMediaIndex(index);
    setSelectedAnnotationId(null);
    setScreen("annotate");
  }

  async function handleExtractFrames(video: MediaSample, withAi = autoAnnotate) {
    await runWithProgress(`Extracting frames from ${video.fileName}`, async () => {
      const result = await extractFrames(
        video.id,
        sampleEverySeconds,
        withAi,
        withAi ? ["vehicle", "plate"] : [importTask],
        vehicleModelKey,
        plateModelKey
      );
      await refreshDataset(datasetId);
      setAnnotationsByMedia({});
      setActiveTab("media");
      setStatus(result.message ?? "Frames extracted");
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Frame extraction failed"));
  }

  async function handleAiSuggestion(item: MediaSample, task: "vehicle" | "plate") {
    await runWithProgress(`Creating ${task} suggestions for ${item.fileName}`, async () => {
      const result = await autoAnnotateMedia(
        item.id,
        task,
        task === "vehicle" ? vehicleModelKey : plateModelKey
      );
      const updated = await listAnnotations(item.id);
      setAnnotationsByMedia((current) => ({ ...current, [item.id]: updated }));
      setStatus(result.message ?? "AI suggestions created");
    }).catch((error) => setStatus(error instanceof Error ? error.message : "AI suggestion failed"));
  }

  async function handleAiBoth(item: MediaSample) {
    await runWithProgress(`Creating vehicle and plate suggestions for ${item.fileName}`, async () => {
      await autoAnnotateMedia(item.id, "vehicle", vehicleModelKey);
      const result = await autoAnnotateMedia(item.id, "plate", plateModelKey);
      const updated = await listAnnotations(item.id);
      setAnnotationsByMedia((current) => ({ ...current, [item.id]: updated }));
      setStatus(result.message ?? "AI suggestions created");
    }).catch((error) => setStatus(error instanceof Error ? error.message : "AI suggestion failed"));
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

  function relabelSelected(classKey: string) {
    if (!selectedAnnotation) {
      return;
    }
    const [task, classIdValue] = classKey.split(":");
    const classId = Number(classIdValue);
    const nextClass = classes.find(
      (annotationClass) => annotationClass.task === task && annotationClass.id === classId
    );
    if (!nextClass) {
      return;
    }
    updateAnnotation({
      ...selectedAnnotation,
      task: nextClass.task,
      classId: nextClass.id,
      className: nextClass.name,
      reviewedByUser: "local_user",
      verifiedAt: new Date().toISOString()
    });
  }

  function updateSelectedBox(field: keyof Annotation["box"], value: number) {
    if (!selectedAnnotation || Number.isNaN(value)) {
      return;
    }
    const nextBox = { ...selectedAnnotation.box, [field]: clamp(value, 0.001, 1) };
    updateAnnotation({
      ...selectedAnnotation,
      box: nextBox,
      reviewedByUser: "local_user",
      verifiedAt: new Date().toISOString()
    });
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

  async function handleDownloadModels() {
    await runWithProgress("Downloading YOLOv8, YOLOv9, and YOLO11 models", async () => {
      const result = await downloadModels();
      const catalog = await listModels();
      setModelOptions(catalog.models);
      setStatus(result.message ?? "Models downloaded");
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Model download failed"));
  }

  function modelSelect(task: "vehicle" | "plate", compact = false) {
    const value = task === "vehicle" ? vehicleModelKey : plateModelKey;
    const setter = task === "vehicle" ? setVehicleModelKey : setPlateModelKey;
    return (
      <label className={compact ? "model-select compact" : "model-select"}>
        <span>{task === "vehicle" ? "Vehicle model" : "Number plate model"}</span>
        <select value={value} onChange={(event) => setter(event.target.value)}>
          {modelOptions
            .filter((model) => model.task === task || model.task === null || model.task === undefined)
            .map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}
                {model.isDownloaded || model.isCustom ? "" : " (download)"}
              </option>
            ))}
        </select>
      </label>
    );
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
            <button title="AI vehicle suggestions" onClick={() => media && handleAiSuggestion(media, "vehicle")} disabled={!media || isProcessing}>
              <Wand2 size={18} />
            </button>
            <button title="AI plate suggestions" onClick={() => media && handleAiSuggestion(media, "plate")} disabled={!media || isProcessing}>
              <Wand2 size={18} />
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
            {isProcessing ? <ProgressStrip label={processingLabel ?? "Processing"} /> : null}
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
            {media ? (
              <div className="ai-action-stack">
                {modelSelect("vehicle", true)}
                {modelSelect("plate", true)}
                <button onClick={() => handleAiSuggestion(media, "vehicle")} disabled={isProcessing}>
                  <Wand2 size={16} />
                  AI vehicle
                </button>
                <button onClick={() => handleAiSuggestion(media, "plate")} disabled={isProcessing}>
                  <Wand2 size={16} />
                  AI plate
                </button>
              </div>
            ) : null}
            {selectedAnnotation ? (
              <div className="annotation-editor">
                <h2>Edit selected</h2>
                <label>
                  <span>Class</span>
                  <select
                    value={`${selectedAnnotation.task}:${selectedAnnotation.classId}`}
                    onChange={(event) => relabelSelected(event.target.value)}
                  >
                    {classes.map((annotationClass) => (
                      <option
                        key={`${annotationClass.task}:${annotationClass.id}`}
                        value={`${annotationClass.task}:${annotationClass.id}`}
                      >
                        {annotationClass.name}
                      </option>
                    ))}
                  </select>
                </label>
                {(["xCenter", "yCenter", "width", "height"] as const).map((field) => (
                  <label key={field}>
                    <span>{field}</span>
                    <input
                      type="number"
                      min="0.001"
                      max="1"
                      step="0.001"
                      value={selectedAnnotation.box[field].toFixed(3)}
                      onChange={(event) => updateSelectedBox(field, Number(event.target.value))}
                    />
                  </label>
                ))}
              </div>
            ) : null}
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
          <button title="Download YOLOv8, YOLOv9, YOLO11" onClick={handleDownloadModels} disabled={isProcessing}>
            <Wand2 size={18} />
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

      <main className="home-layout">
        {isProcessing ? <ProgressStrip label={processingLabel ?? "Processing"} /> : null}
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
            <div className="model-panel">
              <div className="section-title">
                <Wand2 size={18} />
                <h2>AI Models</h2>
              </div>
              <div className="model-grid">
                {modelSelect("vehicle")}
                {modelSelect("plate")}
                <button onClick={handleDownloadModels} disabled={isProcessing}>
                  <Wand2 size={17} />
                  Download YOLOv8 / YOLOv9 / YOLO11
                </button>
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
              {modelSelect("vehicle")}
              {modelSelect("plate")}
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
              {videos.map((item) => (
                <div className="gallery-tile media-card" key={item.id}>
                  <div className="video-thumb">
                    <Film size={30} />
                  </div>
                  <span>{item.fileName}</span>
                  <small>Video source</small>
                  <div className="card-actions">
                    <button onClick={() => handleExtractFrames(item, false)} disabled={isProcessing}>Extract frames</button>
                    <button onClick={() => handleExtractFrames(item, true)} disabled={isProcessing}>Extract + AI</button>
                  </div>
                </div>
              ))}
              {annotatableMedia.map((item, index) => (
                <div className="gallery-tile media-card" key={item.id}>
                  <img src={item.imageUrl} alt={item.fileName} />
                  <span>{item.fileName}</span>
                  {typeof item.frameIndex === "number" ? <small>Frame {item.frameIndex}</small> : null}
                  <div className="card-actions">
                    <button onClick={() => openMedia(index)}>Annotate</button>
                    <button onClick={() => handleAiBoth(item)} disabled={isProcessing}>AI both</button>
                    <button onClick={() => handleAiSuggestion(item, "vehicle")} disabled={isProcessing}>Vehicle</button>
                    <button onClick={() => handleAiSuggestion(item, "plate")} disabled={isProcessing}>Plate</button>
                  </div>
                </div>
              ))}
              {annotatableMedia.length === 0 && videos.length === 0 ? (
                <div className="empty-gallery">No imported media</div>
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

function ProgressStrip({ label }: { label: string }) {
  return (
    <div className="progress-strip" role="status" aria-live="polite">
      <div className="progress-bar" />
      <span>{label}</span>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
