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
  importVideoFolder,
  listAnnotations,
  listImportHistory,
  listMedia,
  listModels,
  saveAnnotations,
  uploadImages
} from "./api";
import AnnotationCanvas from "./components/AnnotationCanvas";
import Sidebar from "./components/Sidebar";
import { classes } from "./data/sample";
import type { ImportHistoryItem, ModelOption } from "./api";
import type { Annotation, AnnotationClass, MediaSample } from "./types";

type ScanResult = {
  image_count: number;
  video_count: number;
  frame_count: number;
  label_count: number;
  issue_count: number;
};
type OpenFolder = { kind: "import" | "video"; id: string } | null;

export default function App() {
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("Traffic Annotation Dataset");
  const [mediaItems, setMediaItems] = useState<MediaSample[]>([]);
  const [screen, setScreen] = useState<"home" | "annotate">("home");
  const [activeTab, setActiveTab] = useState<"dashboard" | "images" | "videos" | "media" | "history">("dashboard");
  const [mediaIndex, setMediaIndex] = useState(0);
  const [selectedClass, setSelectedClass] = useState<AnnotationClass>(classes[2]);
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
  const [importMode, setImportMode] = useState<"auto" | "explicit">("auto");
  const [duplicatePolicy, setDuplicatePolicy] = useState<"skip" | "import_copy">("skip");
  const [frameSampleSeconds, setFrameSampleSeconds] = useState(1);
  const [vehicleModelKey, setVehicleModelKey] = useState("custom_vehicle");
  const [plateModelKey, setPlateModelKey] = useState("custom_plate");

  const annotatableMedia = useMemo(
    () => mediaItems.filter((item) => item.mediaType === "image"),
    [mediaItems]
  );
  const videos = useMemo(() => mediaItems.filter((item) => item.mediaType === "video"), [mediaItems]);
  const [openFolder, setOpenFolder] = useState<OpenFolder>(null);
  const scanFolders = useMemo(
    () => {
      const groups = new Map<string, { history: ImportHistoryItem[]; media: MediaSample[] }>();
      importHistory
        .filter((item) => item.importedImages > 0 || item.importedVideos > 0)
        .forEach((item) => {
          const key = folderKey(item);
          const group = groups.get(key) ?? { history: [], media: [] };
          group.history.push(item);
          groups.set(key, group);
        });
      groups.forEach((group) => {
        const sessionIds = new Set(group.history.map((item) => item.id));
        group.media = mediaItems.filter((mediaItem) => mediaItem.importSessionId && sessionIds.has(mediaItem.importSessionId));
      });
      return Array.from(groups.entries())
        .map(([key, group]) => {
          const latest = group.history[0];
          return {
            key,
            latest,
            histories: group.history,
            media: group.media,
            images: group.media.filter((mediaItem) => mediaItem.mediaType === "image").length,
            videos: group.media.filter((mediaItem) => mediaItem.mediaType === "video").length
          };
        })
        .filter((folder) => folder.media.length > 0 || folder.images > 0 || folder.videos > 0);
    },
    [importHistory, mediaItems]
  );
  const visibleFrames = useMemo(
    () => {
      if (openFolder?.kind === "video") {
        return annotatableMedia.filter((item) => item.parentMediaId === openFolder.id);
      }
      if (openFolder?.kind === "import") {
        const folder = scanFolders.find((item) => item.key === openFolder.id);
        const sessionIds = new Set(folder?.histories.map((item) => item.id) ?? []);
        return annotatableMedia.filter((item) => item.importSessionId && sessionIds.has(item.importSessionId));
      }
      return annotatableMedia.filter((item) => !item.importSessionId);
    },
    [annotatableMedia, openFolder, scanFolders]
  );
  const visibleVideos = useMemo(
    () => {
      if (openFolder?.kind === "import") {
        const folder = scanFolders.find((item) => item.key === openFolder.id);
        const sessionIds = new Set(folder?.histories.map((item) => item.id) ?? []);
        return videos.filter((item) => item.importSessionId && sessionIds.has(item.importSessionId));
      }
      if (openFolder?.kind === "video") {
        return videos.filter((item) => item.id === openFolder.id);
      }
      return videos.filter((item) => !item.importSessionId);
    },
    [openFolder, scanFolders, videos]
  );
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
  const importedLabelCount = useMemo(
    () => annotations.filter((annotation) => annotation.source === "import").length,
    [annotations]
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
    const scanningImages = activeTab === "images";
    const scanningVideos = activeTab === "videos";
    if (!scanningImages && !scanningVideos) {
      setStatus("Open Image Import or Video Frames before scanning");
      return false;
    }
    if (importMode === "auto" && !parentDir.trim() && !(scanningImages ? imageDir : videoDir).trim()) {
      setStatus(scanningImages ? "Enter a parent or image folder path" : "Enter a parent or video folder path");
      return false;
    }
    if (importMode === "explicit" && scanningImages && !imageDir.trim()) {
      setStatus("Enter an image folder path");
      return false;
    }
    if (importMode === "explicit" && scanningVideos && !videoDir.trim()) {
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
    const scanningImages = activeTab === "images";
    await runWithProgress(scanningImages ? "Scanning images and importing labels" : "Scanning video folder", async () => {
      const result =
        scanningImages
          ? await importImageFolder(
              datasetId,
              parentDir,
              imageDir,
              labelDir,
              "plate",
              importMode,
              duplicatePolicy,
              false,
              vehicleModelKey,
              plateModelKey
            )
          : await importVideoFolder(
              datasetId,
              parentDir,
              videoDir,
              "vehicle",
              importMode,
              duplicatePolicy,
              false,
              frameSampleSeconds,
              false,
              vehicleModelKey,
              plateModelKey
            );
      await refreshDataset(datasetId);
      setAnnotationsByMedia({});
      setOpenFolder(null);
      setActiveTab("media");
      setScanResult({
        image_count: result.importedImages,
        video_count: result.importedVideos,
        frame_count: result.importedFrames,
        label_count: result.importedAnnotations,
        issue_count: result.issueCount
      });
      setStatus(
        scanningImages
          ? `Saved ${result.importedImages} images and imported ${result.importedAnnotations} labels`
          : `Saved ${result.importedVideos} videos. Extract frames from Media.`
      );
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Scan failed"));
  }

  function openImageImport() {
    setActiveTab("images");
  }

  function openVideoImport() {
    setActiveTab("videos");
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !datasetId) {
      return;
    }
    await runWithProgress("Uploading images", async () => {
      await uploadImages(datasetId, files);
      await refreshDataset(datasetId);
      setOpenFolder(null);
      setActiveTab("media");
      setStatus(`${files.length} image${files.length === 1 ? "" : "s"} uploaded`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Upload failed"));
  }

  function openMedia(index: number) {
    setMediaIndex(index);
    setSelectedAnnotationId(null);
    setScreen("annotate");
  }

  async function handleExtractFrames(video: MediaSample, withAi = false) {
    await runWithProgress(`Extracting frames from ${video.fileName}`, async () => {
      const result = await extractFrames(
        video.id,
        frameSampleSeconds,
        withAi,
        withAi ? ["vehicle", "plate"] : ["vehicle"],
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

  async function handleBulkAiBoth() {
    if (annotatableMedia.length === 0) {
      return;
    }
    await runWithProgress("Creating vehicle and plate suggestions for all images", async () => {
      for (const item of annotatableMedia) {
        await autoAnnotateMedia(item.id, "vehicle", vehicleModelKey);
        await autoAnnotateMedia(item.id, "plate", plateModelKey);
      }
      setAnnotationsByMedia({});
      setStatus(`AI suggestions created for ${annotatableMedia.length} image${annotatableMedia.length === 1 ? "" : "s"}`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Bulk AI suggestion failed"));
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
    deleteAnnotation(selectedAnnotationId);
  }

  function deleteAnnotation(annotationId: string) {
    replaceAnnotations(annotations.filter((annotation) => annotation.id !== annotationId));
    if (selectedAnnotationId === annotationId) {
      setSelectedAnnotationId(null);
    }
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
            onDeleteAnnotation={deleteAnnotation}
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
              <span>Imported</span>
              <strong>{importedLabelCount}</strong>
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
                <button onClick={() => handleAiBoth(media)} disabled={isProcessing}>
                  <Wand2 size={16} />
                  AI both
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
                <strong>Scan Existing Images</strong>
                <span>Save server image folders and optional YOLO labels.</span>
              </button>
              <button onClick={openVideoImport}>
                <Film size={22} />
                <strong>Scan Videos</strong>
                <span>Save video records, then extract smart frames from Media.</span>
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
              <h2>{activeTab === "images" ? "Existing Image Scan" : "Video Scan and Frame Extraction"}</h2>
            </div>
            <div className="workflow-note">
              {activeTab === "images"
                ? "Scan images from a server folder. If a matching YOLO label file exists in the labels folder, it is imported as a number plate label."
                : "Scan only video files here. Frame extraction happens later from Media using the selected vehicle model and interval."}
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
              ) : null}
              {activeTab === "videos" ? (
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
                    <span>Frame interval seconds</span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={frameSampleSeconds}
                      onChange={(event) => setFrameSampleSeconds(clamp(Number(event.target.value), 0.1, 60))}
                    />
                  </label>
                  {modelSelect("vehicle")}
                </>
              ) : null}
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

            <div className="action-row">
              <button onClick={handleScan}>
                <FolderSearch size={17} />
                {activeTab === "images" ? "Scan images and labels" : "Scan videos"}
              </button>
              <span>{status}</span>
            </div>

            {scanResult ? (
              <div className="scan-summary">
                <div>
                  <span>Saved images</span>
                  <strong>{scanResult.image_count}</strong>
                </div>
                <div>
                  <span>Saved videos</span>
                  <strong>{scanResult.video_count}</strong>
                </div>
                <div>
                  <span>Frames</span>
                  <strong>{scanResult.frame_count}</strong>
                </div>
                <div>
                  <span>Labels</span>
                  <strong>{scanResult.label_count}</strong>
                </div>
                <div>
                  <span>Issues</span>
                  <strong>{scanResult.issue_count}</strong>
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
            <div className="action-row">
              {openFolder ? (
                <button onClick={() => setOpenFolder(null)}>
                  <GalleryHorizontalEnd size={17} />
                  All media
                </button>
              ) : null}
              <button onClick={handleBulkAiBoth} disabled={isProcessing || annotatableMedia.length === 0}>
                <Wand2 size={17} />
                AI both all
              </button>
            </div>
            <div className="gallery-grid home-gallery">
              {!openFolder
                ? scanFolders.map((folder) => (
                    <div className="gallery-tile media-card" key={folder.key}>
                      <div className="video-thumb">
                        <FolderSearch size={30} />
                      </div>
                      <span>{folderLabel(folder.latest)}</span>
                      <small>
                        {folder.images} images, {folder.videos} videos, {folder.histories.length} scan{folder.histories.length === 1 ? "" : "s"}
                      </small>
                      <div className="card-actions">
                        <button onClick={() => setOpenFolder({ kind: "import", id: folder.key })}>
                          Open folder
                        </button>
                      </div>
                    </div>
                  ))
                : null}
              {visibleVideos.map((item) => (
                <div className="gallery-tile media-card" key={item.id}>
                  <div className="video-thumb">
                    <Film size={30} />
                  </div>
                  <span>{item.fileName}</span>
                  <FrameStatus count={frameCountForVideo(annotatableMedia, item.id)} />
                  <small>Interval {frameSampleSeconds}s with selected vehicle model</small>
                  <div className="card-actions">
                    <button onClick={() => setOpenFolder({ kind: "video", id: item.id })}>Open folder</button>
                    <button onClick={() => handleExtractFrames(item, false)} disabled={isProcessing}>Smart frames</button>
                    <button onClick={() => handleExtractFrames(item, true)} disabled={isProcessing}>Smart frames + AI</button>
                  </div>
                </div>
              ))}
              {visibleFrames.map((item) => (
                <div className="gallery-tile media-card" key={item.id}>
                  <img src={item.imageUrl} alt={item.fileName} />
                  <span>{item.fileName}</span>
                  {typeof item.frameIndex === "number" ? <small>Frame {item.frameIndex}</small> : null}
                  <div className="card-actions">
                    <button onClick={() => openMedia(annotatableMedia.findIndex((mediaItem) => mediaItem.id === item.id))}>Annotate</button>
                    <button onClick={() => handleAiBoth(item)} disabled={isProcessing}>AI both</button>
                    <button onClick={() => handleAiSuggestion(item, "vehicle")} disabled={isProcessing}>Vehicle</button>
                    <button onClick={() => handleAiSuggestion(item, "plate")} disabled={isProcessing}>Plate</button>
                  </div>
                </div>
              ))}
              {annotatableMedia.length === 0 && videos.length === 0 ? (
                <div className="empty-gallery">No imported media</div>
              ) : null}
              {!openFolder && scanFolders.length > 0 && visibleFrames.length === 0 && visibleVideos.length === 0 ? null : null}
              {openFolder && visibleFrames.length === 0 && visibleVideos.length === 0 ? (
                <div className="empty-gallery">No media in this folder</div>
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

function FrameStatus({ count }: { count: number }) {
  return (
    <small className={count > 0 ? "frame-status ready" : "frame-status empty"}>
      {count > 0 ? `Frames extracted: ${count}` : "Frames not extracted"}
    </small>
  );
}

function frameCountForVideo(media: MediaSample[], videoId: string) {
  return media.filter((item) => item.parentMediaId === videoId).length;
}

function folderKey(item: ImportHistoryItem) {
  const path =
    item.sourceType === "video_folder"
      ? item.parentDir || item.videoDir || item.imageDir
      : item.parentDir || item.imageDir || item.videoDir;
  return `${item.sourceType}:${normalizePath(path || item.id)}`;
}

function folderLabel(item: ImportHistoryItem) {
  const path = item.parentDir || item.imageDir || item.videoDir || "Import";
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalized.split("/").filter(Boolean).pop();
  if (item.sourceType === "video_folder") {
    return name ? `Video import: ${name}` : "Video import";
  }
  if (item.sourceType === "image_folder") {
    return name ? `Image import: ${name}` : "Image import";
  }
  return name ? `Mixed import: ${name}` : "Mixed import";
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
