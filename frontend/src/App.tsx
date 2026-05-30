import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  FolderSearch,
  GalleryHorizontalEnd,
  ImagePlus,
  ListChecks,
  MoreHorizontal,
  Save,
  Square,
  SquareCheck,
  Trash2,
  Wand2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import {
  autoAnnotateMedia,
  browseDirectories,
  deleteMedia,
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
import type { DirectoryEntry, ImportHistoryItem, ModelOption } from "./api";
import type { Annotation, AnnotationClass, AnnotationTask, MediaSample } from "./types";

type ScanResult = {
  image_count: number;
  video_count: number;
  frame_count: number;
  label_count: number;
  issue_count: number;
};
type OpenFolder = { kind: "import" | "video"; id: string } | null;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("Traffic Annotation Dataset");
  const [mediaItems, setMediaItems] = useState<MediaSample[]>([]);
  const [screen, setScreen] = useState<"home" | "annotate">("home");
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
  const [frameSampleFps, setFrameSampleFps] = useState(30);
  const [vehicleModelKey, setVehicleModelKey] = useState("custom_vehicle");
  const [plateModelKey, setPlateModelKey] = useState("custom_plate");
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [folderAliases, setFolderAliases] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("itis.folderAliases") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [aiMenuKey, setAiMenuKey] = useState<string | null>(null);
  const [bulkTasks, setBulkTasks] = useState<Record<AnnotationTask, boolean>>({ vehicle: true, plate: true });
  const [directoryPicker, setDirectoryPicker] = useState<{
    target: "parent" | "images" | "videos" | "labels";
    entry: DirectoryEntry | null;
  } | null>(null);

  const activeTab = tabFromPath(location.pathname);
  const setActiveTab = (tab: "dashboard" | "images" | "videos" | "media" | "history") => {
    navigate(tab === "dashboard" ? "/dashboard" : `/${tab}`);
  };

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
  const visibleFrameIds = useMemo(() => visibleFrames.map((item) => item.id), [visibleFrames]);
  const selectedVisibleCount = useMemo(
    () => visibleFrameIds.filter((id) => selectedMediaIds.has(id)).length,
    [selectedMediaIds, visibleFrameIds]
  );
  const bulkProgressPercent = bulkProgress?.total
    ? Math.round((bulkProgress.done / bulkProgress.total) * 100)
    : 0;

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

  useEffect(() => {
    window.localStorage.setItem("itis.folderAliases", JSON.stringify(folderAliases));
  }, [folderAliases]);

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
              1 / frameSampleFps,
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
        1 / frameSampleFps,
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

  async function handleAiTasks(item: MediaSample, tasks: AnnotationTask[]) {
    if (tasks.length === 0) {
      setStatus("Choose vehicle, plate, or both");
      return;
    }
    await runWithProgress(`Creating AI suggestions for ${item.fileName}`, async () => {
      let result: { message?: string } = {};
      for (const task of tasks) {
        result = await autoAnnotateMedia(
          item.id,
          task,
          task === "vehicle" ? vehicleModelKey : plateModelKey
        );
      }
      const updated = await listAnnotations(item.id);
      setAnnotationsByMedia((current) => ({ ...current, [item.id]: updated }));
      setStatus(result.message ?? "AI suggestions created");
    }).catch((error) => setStatus(error instanceof Error ? error.message : "AI suggestion failed"));
  }

  async function handleBulkAiBoth() {
    const targets = selectedMediaIds.size
      ? annotatableMedia.filter((item) => selectedMediaIds.has(item.id))
      : visibleFrames.length
        ? visibleFrames
        : annotatableMedia;
    await handleBulkAiForTasks(targets, selectedBulkTasks());
  }

  async function handleBulkAiBothFor(targets: MediaSample[]) {
    await handleBulkAiForTasks(targets, ["vehicle", "plate"]);
  }

  async function handleBulkAiForTasks(targets: MediaSample[], tasks: AnnotationTask[]) {
    if (targets.length === 0) {
      return;
    }
    if (tasks.length === 0) {
      setStatus("Choose vehicle, plate, or both");
      return;
    }
    await runWithProgress("Creating AI suggestions", async () => {
      setBulkProgress({ done: 0, total: targets.length });
      for (const [index, item] of targets.entries()) {
        for (const task of tasks) {
          await autoAnnotateMedia(
            item.id,
            task,
            task === "vehicle" ? vehicleModelKey : plateModelKey
          );
        }
        setBulkProgress({ done: index + 1, total: targets.length });
      }
      setAnnotationsByMedia({});
      setStatus(`AI suggestions created for ${targets.length} image${targets.length === 1 ? "" : "s"}`);
      setBulkProgress(null);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Bulk AI suggestion failed"));
  }

  function selectedBulkTasks(): AnnotationTask[] {
    return (["vehicle", "plate"] as AnnotationTask[]).filter((task) => bulkTasks[task]);
  }

  function toggleMediaSelection(mediaId: string) {
    setSelectedMediaIds((current) => {
      const next = new Set(current);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  }

  function toggleSelectVisibleFrames() {
    setSelectedMediaIds((current) => {
      const next = new Set(current);
      const allSelected = visibleFrameIds.length > 0 && visibleFrameIds.every((id) => next.has(id));
      visibleFrameIds.forEach((id) => {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      });
      return next;
    });
  }

  async function handleDeleteMediaItems(items: MediaSample[]) {
    if (items.length === 0) {
      return;
    }
    await runWithProgress(`Deleting ${items.length} image${items.length === 1 ? "" : "s"}`, async () => {
      for (const item of items) {
        await deleteMedia(item.id);
      }
      await refreshDataset(datasetId);
      setAnnotationsByMedia((current) => {
        const next = { ...current };
        items.forEach((item) => delete next[item.id]);
        return next;
      });
      setSelectedMediaIds((current) => {
        const next = new Set(current);
        items.forEach((item) => next.delete(item.id));
        return next;
      });
      setStatus(`Deleted ${items.length} image${items.length === 1 ? "" : "s"}`);
    }).catch((error) => setStatus(error instanceof Error ? error.message : "Delete failed"));
  }

  function renameOpenFolder(value: string) {
    if (!openFolder) {
      return;
    }
    setFolderAliases((current) => ({ ...current, [openFolder.id]: value }));
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

  function acceptAnnotation(annotationId: string) {
    replaceAnnotations(
      annotations.map((annotation) =>
        annotation.id === annotationId
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

  async function openDirectoryPicker(target: "parent" | "images" | "videos" | "labels") {
    const currentPath =
      target === "parent" ? parentDir : target === "images" ? imageDir : target === "videos" ? videoDir : labelDir;
    setDirectoryPicker({ target, entry: null });
    try {
      const entry = await browseDirectories(currentPath || parentDir || null);
      setDirectoryPicker({ target, entry });
    } catch (error) {
      setDirectoryPicker(null);
      setStatus(error instanceof Error ? error.message : "Could not browse directory");
    }
  }

  async function browseTo(path: string) {
    if (!directoryPicker) {
      return;
    }
    try {
      const entry = await browseDirectories(path);
      setDirectoryPicker({ ...directoryPicker, entry });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not browse directory");
    }
  }

  function chooseDirectory(path: string) {
    if (!directoryPicker) {
      return;
    }
    if (directoryPicker.target === "parent") {
      setParentDir(path);
    } else if (directoryPicker.target === "images") {
      setImageDir(path);
    } else if (directoryPicker.target === "videos") {
      setVideoDir(path);
    } else {
      setLabelDir(path);
    }
    setDirectoryPicker(null);
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
            onAcceptAnnotation={acceptAnnotation}
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
        {bulkProgress ? <ProgressStrip label={`AI annotation ${bulkProgressPercent}% (${bulkProgress.done}/${bulkProgress.total})`} /> : null}
        <nav className="dashboard-tabs" aria-label="Dashboard sections">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive || location.pathname === "/" ? "active" : "")}>
            <BarChart3 size={17} />
            Dashboard
          </NavLink>
          <NavLink to="/images" className={({ isActive }) => (isActive ? "active" : "")}>
            <ImagePlus size={17} />
            Image Import
          </NavLink>
          <NavLink to="/videos" className={({ isActive }) => (isActive ? "active" : "")}>
            <Film size={17} />
            Video Frames
          </NavLink>
          <NavLink to="/media" className={({ isActive }) => (isActive ? "active" : "")}>
            <GalleryHorizontalEnd size={17} />
            Media
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
            <ListChecks size={17} />
            History
          </NavLink>
        </nav>

        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={
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
          } />

          <Route path="/images" element={
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
                <button type="button" onClick={() => openDirectoryPicker("parent")}>
                  <FolderOpen size={15} />
                  Browse
                </button>
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
                    <button type="button" onClick={() => openDirectoryPicker("images")}>
                      <FolderOpen size={15} />
                      Browse
                    </button>
                  </label>
                  <label>
                    <span>Labels</span>
                    <input
                      value={labelDir}
                      onChange={(event) => setLabelDir(event.target.value)}
                      placeholder="C:\\datasets\\traffic\\labels"
                    />
                    <button type="button" onClick={() => openDirectoryPicker("labels")}>
                      <FolderOpen size={15} />
                      Browse
                    </button>
                  </label>
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
          } />

          <Route path="/videos" element={
          <section className="import-surface">
            <div className="section-title">
              <Film size={20} />
              <h2>Video Scan and Frame Extraction</h2>
            </div>
            <div className="workflow-note">
              Scan only video files here. Frame extraction happens later from Media using the selected vehicle model and FPS.
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
                <button type="button" onClick={() => openDirectoryPicker("parent")}>
                  <FolderOpen size={15} />
                  Browse
                </button>
              </label>
              <label>
                <span>Videos</span>
                <input
                  value={videoDir}
                  onChange={(event) => setVideoDir(event.target.value)}
                  placeholder="C:\\datasets\\traffic\\videos"
                />
                <button type="button" onClick={() => openDirectoryPicker("videos")}>
                  <FolderOpen size={15} />
                  Browse
                </button>
              </label>
              <label>
                <span>Analysis FPS</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  value={frameSampleFps}
                  onChange={(event) => setFrameSampleFps(clamp(Number(event.target.value), 1, 60))}
                />
              </label>
              {modelSelect("vehicle")}
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
                Scan videos
              </button>
              <span>{status}</span>
            </div>

            {scanResult ? <ScanSummary scanResult={scanResult} /> : null}
          </section>
          } />

          <Route path="/media" element={
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
              {visibleFrames.length > 0 ? (
                <button onClick={toggleSelectVisibleFrames}>
                  {selectedVisibleCount === visibleFrames.length ? <SquareCheck size={17} /> : <Square size={17} />}
                  {selectedVisibleCount === visibleFrames.length ? "Clear visible" : "Select visible"}
                </button>
              ) : null}
              <button onClick={() => setAiMenuKey(aiMenuKey === "bulk" ? null : "bulk")} disabled={isProcessing || annotatableMedia.length === 0}>
                <MoreHorizontal size={17} />
                {selectedMediaIds.size ? `AI selected (${selectedMediaIds.size})` : "AI annotate"}
              </button>
              {selectedMediaIds.size ? (
                <button
                  onClick={() => handleDeleteMediaItems(annotatableMedia.filter((item) => selectedMediaIds.has(item.id)))}
                  disabled={isProcessing}
                >
                  <Trash2 size={17} />
                  Delete selected
                </button>
              ) : null}
            </div>
            {aiMenuKey === "bulk" ? (
              <AiAnnotationMenu
                vehicleModel={modelSelect("vehicle", true)}
                plateModel={modelSelect("plate", true)}
                tasks={bulkTasks}
                onToggleTask={(task) => setBulkTasks((current) => ({ ...current, [task]: !current[task] }))}
                onRun={() => {
                  setAiMenuKey(null);
                  handleBulkAiBoth();
                }}
              />
            ) : null}
            {openFolder ? (
              <div className="folder-tools">
                <label>
                  <span>Folder display name</span>
                  <input
                    value={folderAliases[openFolder.id] ?? ""}
                    onChange={(event) => renameOpenFolder(event.target.value)}
                    placeholder="Rename this folder in the gallery"
                  />
                </label>
              </div>
            ) : null}
            <div className="gallery-grid home-gallery">
              {!openFolder
                ? scanFolders.map((folder) => (
                    <div className="gallery-tile media-card" key={folder.key}>
                      <div className="video-thumb">
                        <FolderSearch size={30} />
                      </div>
                      <span>{folderAliases[folder.key] || folderLabel(folder.latest)}</span>
                      <small>
                        {folder.images} images, {folder.videos} videos, {folder.histories.length} scan{folder.histories.length === 1 ? "" : "s"}
                      </small>
                      <div className="card-actions">
                        <button onClick={() => setOpenFolder({ kind: "import", id: folder.key })}>
                          Open folder
                        </button>
                        <button onClick={() => {
                          setOpenFolder({ kind: "import", id: folder.key });
                          setSelectedMediaIds(new Set(folder.media.filter((item) => item.mediaType === "image").map((item) => item.id)));
                        }}>
                          Select images
                        </button>
                        <button
                          onClick={() => setAiMenuKey(aiMenuKey === folder.key ? null : folder.key)}
                          disabled={isProcessing || folder.images === 0}
                        >
                          <MoreHorizontal size={15} />
                          AI annotations
                        </button>
                      </div>
                      {aiMenuKey === folder.key ? (
                        <AiAnnotationMenu
                          vehicleModel={modelSelect("vehicle", true)}
                          plateModel={modelSelect("plate", true)}
                          tasks={bulkTasks}
                          onToggleTask={(task) => setBulkTasks((current) => ({ ...current, [task]: !current[task] }))}
                          onRun={() => {
                            setAiMenuKey(null);
                            handleBulkAiForTasks(folder.media.filter((item) => item.mediaType === "image"), selectedBulkTasks());
                          }}
                        />
                      ) : null}
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
                  <small>Analyze up to {frameSampleFps} fps with selected vehicle model</small>
                  <div className="card-actions">
                    <button onClick={() => setOpenFolder({ kind: "video", id: item.id })}>Open folder</button>
                    <button onClick={() => handleExtractFrames(item, false)} disabled={isProcessing}>Smart frames</button>
                    <button onClick={() => handleExtractFrames(item, true)} disabled={isProcessing}>Smart frames + AI</button>
                  </div>
                </div>
              ))}
              {visibleFrames.map((item) => (
                <div className={selectedMediaIds.has(item.id) ? "gallery-tile media-card selected" : "gallery-tile media-card"} key={item.id}>
                  <button className="select-overlay" onClick={() => toggleMediaSelection(item.id)} title="Select image">
                    {selectedMediaIds.has(item.id) ? <SquareCheck size={18} /> : <Square size={18} />}
                  </button>
                  <img src={item.imageUrl} alt={item.fileName} />
                  <span>{item.fileName}</span>
                  {typeof item.frameIndex === "number" ? <small>Frame {item.frameIndex}</small> : null}
                  <div className="card-actions">
                    <button onClick={() => openMedia(annotatableMedia.findIndex((mediaItem) => mediaItem.id === item.id))}>Annotate</button>
                    <button onClick={() => setAiMenuKey(aiMenuKey === item.id ? null : item.id)} disabled={isProcessing}>
                      <MoreHorizontal size={15} />
                      AI
                    </button>
                    <button onClick={() => handleAiSuggestion(item, "vehicle")} disabled={isProcessing}>Vehicle</button>
                    <button onClick={() => handleAiSuggestion(item, "plate")} disabled={isProcessing}>Plate</button>
                    <button onClick={() => handleDeleteMediaItems([item])} disabled={isProcessing}>Delete</button>
                  </div>
                  {aiMenuKey === item.id ? (
                    <AiAnnotationMenu
                      vehicleModel={modelSelect("vehicle", true)}
                      plateModel={modelSelect("plate", true)}
                      tasks={bulkTasks}
                      onToggleTask={(task) => setBulkTasks((current) => ({ ...current, [task]: !current[task] }))}
                      onRun={() => {
                        setAiMenuKey(null);
                        handleAiTasks(item, selectedBulkTasks());
                      }}
                    />
                  ) : null}
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
          } />

          <Route path="/history" element={
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
          } />
        </Routes>
        {directoryPicker ? (
          <DirectoryPickerDialog
            target={directoryPicker.target}
            entry={directoryPicker.entry}
            onBrowse={browseTo}
            onChoose={chooseDirectory}
            onClose={() => setDirectoryPicker(null)}
          />
        ) : null}
      </main>
    </div>
  );
}

function AiAnnotationMenu({
  vehicleModel,
  plateModel,
  tasks,
  onToggleTask,
  onRun
}: {
  vehicleModel: ReactNode;
  plateModel: ReactNode;
  tasks: Record<AnnotationTask, boolean>;
  onToggleTask: (task: AnnotationTask) => void;
  onRun: () => void;
}) {
  const hasTask = tasks.vehicle || tasks.plate;
  return (
    <div className="ai-menu">
      <div className="toggle-grid">
        <label>
          <input type="checkbox" checked={tasks.vehicle} onChange={() => onToggleTask("vehicle")} />
          Vehicle
        </label>
        <label>
          <input type="checkbox" checked={tasks.plate} onChange={() => onToggleTask("plate")} />
          Plate
        </label>
      </div>
      {tasks.vehicle ? vehicleModel : null}
      {tasks.plate ? plateModel : null}
      <button onClick={onRun} disabled={!hasTask}>
        <Wand2 size={16} />
        Add AI annotations
      </button>
    </div>
  );
}

function DirectoryPickerDialog({
  target,
  entry,
  onBrowse,
  onChoose,
  onClose
}: {
  target: "parent" | "images" | "videos" | "labels";
  entry: DirectoryEntry | null;
  onBrowse: (path: string) => void;
  onChoose: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="directory-dialog">
        <div className="dialog-title">
          <h2>Select {target} folder</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {entry ? (
          <>
            <div className="directory-path">{entry.path}</div>
            <div className="directory-actions">
              {entry.parent ? <button onClick={() => onBrowse(entry.parent!)}>Up</button> : null}
              <button onClick={() => onChoose(entry.path)}>
                <Check size={16} />
                Use this folder
              </button>
            </div>
            <div className="directory-list">
              {entry.directories.map((name) => {
                const path = `${entry.path.replace(/[\\/]+$/, "")}\\${name}`;
                return (
                  <button key={path} onClick={() => onBrowse(path)}>
                    <FolderOpen size={16} />
                    <span>{name}</span>
                  </button>
                );
              })}
              {entry.directories.length === 0 ? <p className="empty-state">No child folders</p> : null}
            </div>
          </>
        ) : (
          <ProgressStrip label="Loading folders" />
        )}
      </div>
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

function ScanSummary({ scanResult }: { scanResult: ScanResult }) {
  return (
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

function tabFromPath(pathname: string): "dashboard" | "images" | "videos" | "media" | "history" {
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "images" || first === "videos" || first === "media" || first === "history") {
    return first;
  }
  return "dashboard";
}
