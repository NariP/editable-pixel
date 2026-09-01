import {
  PatchHistory,
  addFrame,
  addLayer,
  addPaletteColor,
  applyPatch,
  clearNormalSelection,
  clearSelection,
  createDocumentPatch,
  duplicateFrame,
  flipSelection,
  getNormalPixels,
  getPixels,
  moveSelection,
  pasteLayer,
  removeFrameLightingKeyframe,
  removeFrame,
  removeLayer,
  removePaletteColor,
  resetNormalFrame,
  reorderFrame,
  reorderLayer,
  renameLayer,
  replaceColor,
  setFrameDuration,
  setFrameLighting,
  setFrameLightingInterpolation,
  setLayerVisibility,
  type Patch
} from "@editable-pixel/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DEFAULT_FRAME_LIGHTING, NEUTRAL_NORMAL, assertPixelDocument, createDocumentId, createPixelDocument, parsePixelDocument, resolveFrameLighting, type Frame, type FrameLighting, type FrameLightingInterpolation, type Layer, type PixelDocument, type Rect, type Selection } from "@editable-pixel/document";
import {
  ProjectAutosaveQueue,
  ProjectRevisionConflictError,
  ProjectUnavailableError,
  clonePixelProject,
  commitPixelProject,
  createPixelProject,
  parsePixelProject,
  type PixelProject,
  type ProjectSource,
  type ProjectSaveState
} from "@editable-pixel/project";
import { normalVectorToPacked, packedNormalToRgb, packedNormalToVector, renderRgba, type LightSettings } from "@editable-pixel/renderer";
import type { WebControlCommand, WebImportFile } from "@editable-pixel/server";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  PiCursor, PiCursorFill, PiEraser, PiEraserFill, PiPaintBucket, PiPaintBucketFill,
  PiPencilSimple, PiPencilSimpleFill
} from "react-icons/pi";
import {
  TbAdjustments, TbArrowBackUp, TbArrowDown, TbArrowForwardUp, TbArrowLeft, TbArrowRight, TbArrowUp,
  TbChevronDown, TbChevronRight, TbColorPicker, TbCopy, TbCurrentLocation, TbDeviceFloppy, TbDownload, TbFileImport, TbFilePlus, TbFileTypePng,
  TbColumns2, TbColumns2Filled, TbFlipHorizontal, TbFlipVertical, TbGridDots, TbJson, TbMaximize,
  TbBulb, TbBulbOff, TbEye, TbEyeOff, TbFolderOpen, TbGripVertical, TbKeyframe, TbKeyframeFilled, TbLayersIntersect, TbPalette, TbPhotoOff, TbPlayerPlay, TbPlayerStop, TbPlus, TbRefresh, TbStack,
  TbPointerPlus, TbQuestionMark, TbSphere, TbSun, TbTrash, TbX, TbZoomIn, TbZoomOut
} from "react-icons/tb";
import { VscSaveAs } from "react-icons/vsc";
import type { IconType } from "react-icons";

import { Button } from "./components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, useResizableDefaultLayout } from "./components/ui/resizable.js";
import { SelectControl } from "./components/ui/select.js";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { downloadAnimationGif, downloadDocument, downloadLitPng, downloadLitSpriteSheet, downloadNormalPng, downloadNormalSpriteSheet, downloadPng, downloadProject, downloadSpriteSheet } from "./export.js";
import { PixelCanvas, type EditMapMode, type NormalPreviewMode, type OnionSkinSettings, type Tool } from "./PixelCanvas.js";
import { usePixelSession, type ConnectionStatus } from "./session.js";
import {
  cloneSettings, createWorkspaceKey, deleteRecentProject, listRecentProjects, loadWorkspace, restoreEmbeddedProjectSources, restoreSourceUrls, saveWorkspace, settingsEqual,
  type ConvertSettings, type InspectorTab, type RecentProjectSummary, type SourceAsset, type SourceFrameAsset, type WorkspaceSnapshot
} from "./workspace.js";

const defaultSettings: ConvertSettings = {
  canvasWidth: 32, canvasHeight: 32, colorCount: 16, contentScale: 0.8,
  alignment: "center", dithering: "none", background: "alpha"
};
interface ConversionPreview {
  document: PixelDocument;
  sourceId: string;
  settings: ConvertSettings;
}
interface PendingImport {
  imageFiles: File[];
  otherFiles: File[];
}
interface PixelClipboard {
  documentId: string;
  map: EditMapMode;
  layerId: string;
  frameId: string;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  pixels: number[];
  selectedOffsets?: number[];
  pasteOffset: number;
}
interface LayerClipboard {
  documentId: string;
  layer: Layer;
}
interface FrameClipboard {
  documentId: string;
  frameId: string;
}
type ClipboardKind = "pixels" | "layer" | "frame";
type KeyboardTarget = "canvas" | "layers" | "frames";
type SelectionAction = "move-left" | "move-right" | "move-up" | "move-down" | "copy" | "clear" | "flip-h" | "flip-v";

function serializePixelClipboard(copied: PixelClipboard): string {
  return JSON.stringify({
    format: "editable-pixel-selection",
    version: 1,
    map: copied.map,
    width: copied.width,
    height: copied.height,
    pixels: copied.pixels,
    ...(copied.selectedOffsets ? { selectedOffsets: copied.selectedOffsets } : {})
  });
}

function webImportFileToFile(input: WebImportFile): File {
  const binary = window.atob(input.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], input.name, { type: input.mimeType });
}

function selectionMatchesClipboardSource(selection: Selection, copied: PixelClipboard, canvasWidth: number): boolean {
  if (
    selection.layerId !== copied.layerId ||
    selection.frameId !== copied.frameId ||
    selection.x !== copied.sourceX ||
    selection.y !== copied.sourceY ||
    selection.width !== copied.width ||
    selection.height !== copied.height
  ) return false;
  if (!copied.selectedOffsets) return selection.type === "rect";
  if (selection.type !== "mask") return false;
  const offsets = selection.indices.map((index) => {
    const x = index % canvasWidth;
    const y = Math.floor(index / canvasWidth);
    return (y - selection.y) * selection.width + x - selection.x;
  });
  return offsets.length === copied.selectedOffsets.length
    && offsets.every((offset, index) => offset === copied.selectedOffsets![index]);
}

function selectedPixelIndices(selection: Selection, canvasWidth: number): number[] {
  if (selection.type === "mask") return [...selection.indices];
  const indices: number[] = [];
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      indices.push(y * canvasWidth + x);
    }
  }
  return indices;
}

const standardCanvasSizes = [16, 32, 64, 128];
const canvasOptions = [
  ...standardCanvasSizes.map((size) => ({ value: String(size), label: `${size} × ${size}` })),
  { value: "custom", label: "Custom" }
];
const alignmentOptions = [{ value: "center", label: "Center" }, { value: "bottom-center", label: "Bottom" }];
const backgroundOptions = [{ value: "alpha", label: "Alpha" }, { value: "solid", label: "Solid" }];
const ditheringOptions = [{ value: "none", label: "None" }, { value: "floyd-steinberg", label: "Floyd" }];
const lightingTransitionOptions = [
  { value: "linear", label: "Linear" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in-out" },
  { value: "hold", label: "Hold" }
] as const;
const lightingShadingOptions = [
  { value: "toon-palette", label: "Toon palette" },
  { value: "smooth", label: "Smooth" }
] as const;
const toonStepOptions = [3, 4, 5, 6].map((steps) => ({ value: String(steps), label: `${steps} steps` }));
const canvasBackgroundPresets = ["#d8d5cc", "#f4f0e6", "#9ba097", "#51564e", "#171a17"];
const canvasBackgroundStorageKey = "editable-pixel:canvas-background";
const toolLabels: Array<{ value: Tool; key: string; label: string; icon: IconType; activeIcon: IconType }> = [
  { value: "pen", key: "P", label: "Pen", icon: PiPencilSimple, activeIcon: PiPencilSimpleFill },
  { value: "eraser", key: "E", label: "Eraser", icon: PiEraser, activeIcon: PiEraserFill },
  { value: "fill", key: "F", label: "Fill", icon: PiPaintBucket, activeIcon: PiPaintBucketFill },
  { value: "select", key: "S", label: "Select", icon: PiCursor, activeIcon: PiCursorFill }
];

export function App() {
  const framesPanelLayout = useResizableDefaultLayout({
    id: "editable-pixel-clips-frames",
    panelIds: ["clips-panel", "frames-panel"],
    storage: window.sessionStorage,
    onlySaveAfterUserInteractions: true
  });
  const initialDocument = useMemo(() => createPixelDocument({
    width: 32, height: 32,
    palette: ["#00000000", "#171a17ff", "#f4f0e6ff", "#ff5c35ff", "#b8ff3dff"]
  }), []);
  const initialQuery = useMemo(() => new URLSearchParams(window.location.search), []);
  const sessionId = initialQuery.get("session") ?? undefined;
  const workspaceHandoffId = initialQuery.get("workspace") ?? undefined;
  const workspaceKey = useMemo(() => createWorkspaceKey(sessionId), [sessionId]);
  const workspaceLoadKey = useMemo(
    () => workspaceHandoffId ? createWorkspaceKey(workspaceHandoffId) : workspaceKey,
    [workspaceHandoffId, workspaceKey]
  );
  const initialProject = useMemo(() => createPixelProject({
    name: "Untitled Project",
    document: initialDocument
  }), [initialDocument]);
  const [project, setProject] = useState(initialProject);
  const projectRef = useRef(project);
  const [pixelDocument, setPixelDocument] = useState(initialDocument);
  const documentRef = useRef(pixelDocument);
  const historyRef = useRef(new PatchHistory());
  const activeIdsRef = useRef<{ sourceId?: string }>({});
  const sessionDocumentPurposeRef = useRef<"load" | "conversion" | undefined>(undefined);
  const webCommandActorRef = useRef<"user" | "ai">("user");
  const pendingConversionActorRef = useRef<"user" | "ai">("user");
  const sessionHydratedRef = useRef(false);
  const previewRequestRef = useRef(0);
  const handledConversionSettingsRequestRef = useRef(0);
  const [activeLayerId, setActiveLayerId] = useState("artwork");
  const [activeFrameId, setActiveFrameId] = useState("frame-1");
  const [keyboardTarget, setKeyboardTargetState] = useState<KeyboardTarget>("canvas");
  const [tool, setTool] = useState<Tool>("select");
  const [shiftPressed, setShiftPressed] = useState(false);
  const [colorIndex, setColorIndex] = useState(1);
  const [editMap, setEditMap] = useState<EditMapMode>("color");
  const [normalValue, setNormalValue] = useState(NEUTRAL_NORMAL);
  const [normalPreview, setNormalPreview] = useState<NormalPreviewMode>("lit");
  const [light, setLight] = useState<LightSettings>({ ...DEFAULT_FRAME_LIGHTING });
  const [zoom, setZoom] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const [selectionFitRequest, setSelectionFitRequest] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showLightMarker, setShowLightMarker] = useState(true);
  const [onionSkin, setOnionSkin] = useState<OnionSkinSettings>({
    previous: 1,
    next: 0,
    opacity: 0.3
  });
  const [onionSettingsOpen, setOnionSettingsOpen] = useState(false);
  const [frameAddOpen, setFrameAddOpen] = useState(false);
  const [canvasBackground, setCanvasBackground] = useState(() => {
    const saved = window.sessionStorage.getItem(canvasBackgroundStorageKey);
    return saved && /^#[0-9a-f]{6}$/i.test(saved) ? saved : canvasBackgroundPresets[0]!;
  });
  const [compareMode, setCompareMode] = useState(false);
  const [draftSettings, setDraftSettings] = useState<ConvertSettings>(defaultSettings);
  const [conversionSettingsRequest, setConversionSettingsRequest] = useState(0);
  const [customCanvas, setCustomCanvas] = useState(false);
  const [presets, setPresets] = useState<ConvertSettings[]>(loadPresets);
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("convert");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [projectScopeOpen, setProjectScopeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ sourceId: string }>();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [projectSaveState, setProjectSaveState] = useState<ProjectSaveState>({ status: "saved", savedRevision: 0 });
  const [notice, setNotice] = useState("Import an AI-generated image, or draw on the blank canvas.");
  const [isImporting, setIsImporting] = useState(false);
  const [conversionPreview, setConversionPreview] = useState<ConversionPreview>();
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [newColor, setNewColor] = useState("#ffcf33");
  const [newFixedPaletteColor, setNewFixedPaletteColor] = useState("#b8ff3d");
  const [colorPickTarget, setColorPickTarget] = useState<"edit" | "fixed">();
  const [playing, setPlaying] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);
  const autosaveRef = useRef<ProjectAutosaveQueue | undefined>(undefined);
  const autosaveUnsubscribeRef = useRef<(() => void) | undefined>(undefined);
  const pixelClipboardRef = useRef<PixelClipboard | undefined>(undefined);
  const layerClipboardRef = useRef<LayerClipboard | undefined>(undefined);
  const frameClipboardRef = useRef<FrameClipboard | undefined>(undefined);
  const clipboardKindRef = useRef<ClipboardKind | undefined>(undefined);
  const keyboardTargetRef = useRef<KeyboardTarget>("canvas");
  const pasteFallbackRef = useRef<number | undefined>(undefined);
  const sourcesRef = useRef(sources);
  const draftSettingsRef = useRef(draftSettings);
  const activeSourceIdRef = useRef(activeSourceId);
  const inspectorTabRef = useRef(inspectorTab);
  const lightRef = useRef(light);
  const sessionPersistenceRef = useRef<{ status: ConnectionStatus; token?: string }>({
    status: sessionId ? "connecting" : "standalone"
  });

  projectRef.current = project;
  sourcesRef.current = sources;
  draftSettingsRef.current = draftSettings;
  activeSourceIdRef.current = activeSourceId;
  inspectorTabRef.current = inspectorTab;
  lightRef.current = light;

  const setKeyboardTarget = useCallback((target: KeyboardTarget) => {
    keyboardTargetRef.current = target;
    setKeyboardTargetState(target);
  }, []);

  const updateDraftSettings = useCallback((update: (current: ConvertSettings) => ConvertSettings) => {
    setDraftSettings(update);
    setConversionSettingsRequest((current) => current + 1);
  }, []);

  const configureAutosave = useCallback((savedRevision: number) => {
    autosaveUnsubscribeRef.current?.();
    const queue = new ProjectAutosaveQueue(async (nextProject, expectedRevision) => {
      const pendingSnapshot = createWorkspaceSnapshot(
        nextProject,
        draftSettingsRef.current,
        sourcesRef.current,
        activeSourceIdRef.current,
        inspectorTabRef.current,
        expectedRevision
      );
      await saveWorkspace(workspaceKey, pendingSnapshot);
      await saveWorkspace(`project:${nextProject.id}`, pendingSnapshot);
      if (sessionId) {
        const connection = sessionPersistenceRef.current;
        if (connection.status !== "connected" || !connection.token) {
          throw new ProjectUnavailableError("The local session is reconnecting. Changes are queued in this browser.");
        }
        await persistProjectThroughSession(sessionId, connection.token, nextProject, expectedRevision);
      }
      const savedSnapshot = { ...pendingSnapshot, savedRevision: nextProject.revision };
      await saveWorkspace(workspaceKey, savedSnapshot);
      await saveWorkspace(`project:${nextProject.id}`, savedSnapshot);
      return { revision: nextProject.revision };
    }, savedRevision);
    autosaveUnsubscribeRef.current = queue.subscribe(setProjectSaveState);
    autosaveRef.current = queue;
    return queue;
  }, [sessionId, workspaceKey]);

  useEffect(() => {
    window.sessionStorage.setItem(canvasBackgroundStorageKey, canvasBackground);
  }, [canvasBackground]);

  const commitProjectState = useCallback((mutate: (draft: PixelProject) => void) => {
    const next = commitPixelProject(projectRef.current, mutate);
    projectRef.current = next;
    setProject(next);
    return next;
  }, []);

  const replaceDocument = useCallback((
    next: PixelDocument,
    markDirty = false,
    mutateProject?: (draft: PixelProject) => void
  ) => {
    const projectDocument = withProjectFrameLighting(next);
    documentRef.current = projectDocument;
    setPixelDocument(projectDocument);
    const currentProject = projectRef.current;
    const update = (draft: PixelProject) => {
      const clipId = syncProjectClips(draft, projectDocument, draft.active?.clipId);
      syncProjectSources(draft, projectDocument);
      draft.document = structuredClone(projectDocument);
      draft.active = {
        clipId,
        frameId: projectDocument.frames.some((frame) => frame.id === draft.active?.frameId) ? draft.active!.frameId : projectDocument.frames[0]!.id,
        layerId: projectDocument.layers.some((layer) => layer.id === draft.active?.layerId) ? draft.active!.layerId : projectDocument.layers[0]!.id
      };
      mutateProject?.(draft);
    };
    const updated = markDirty
      ? commitPixelProject(currentProject, update)
      : (() => { const clone = structuredClone(currentProject); update(clone); return clone; })();
    projectRef.current = updated;
    setProject(updated);
    setActiveLayerId((current) => projectDocument.layers.some((layer) => layer.id === current) ? current : projectDocument.layers[0]!.id);
    setActiveFrameId((current) => projectDocument.frames.some((frame) => frame.id === current) ? current : projectDocument.frames[0]!.id);
    setColorIndex((current) => Math.min(current, projectDocument.palette.length - 1));
  }, []);

  const session = usePixelSession(sessionId, useCallback((next, sessionProject, projectChanged) => {
    const current = documentRef.current;
    const purpose = sessionDocumentPurposeRef.current;
    const initialHydration = !sessionHydratedRef.current;
    sessionHydratedRef.current = true;
    const externalEdit = !initialHydration && !purpose && next.revision > current.revision && !sameEditableContent(current, next);
    sessionDocumentPurposeRef.current = undefined;
    historyRef.current = new PatchHistory();
    if (next.selection && JSON.stringify(next.selection) !== JSON.stringify(current.selection)) {
      setTool("select");
      setKeyboardTarget("canvas");
    }
    if (sessionProject && (initialHydration || projectChanged)) {
      const currentProject = projectRef.current;
      const synchronizedProject: PixelProject = {
        ...structuredClone(currentProject),
        id: sessionProject.id,
        name: sessionProject.name,
        revision: sessionProject.revision,
        updatedAt: new Date().toISOString(),
        clips: structuredClone(sessionProject.clips),
        document: structuredClone(next),
        ...(sessionProject.active ? { active: structuredClone(sessionProject.active) } : {})
      };
      projectRef.current = synchronizedProject;
      documentRef.current = next;
      setProject(synchronizedProject);
      setPixelDocument(next);
      setActiveLayerId((currentLayer) => next.layers.some((layer) => layer.id === sessionProject.active?.layerId)
        ? sessionProject.active!.layerId!
        : next.layers.some((layer) => layer.id === currentLayer) ? currentLayer : next.layers[0]!.id);
      setActiveFrameId((currentFrame) => next.frames.some((frame) => frame.id === sessionProject.active?.frameId)
        ? sessionProject.active!.frameId!
        : next.frames.some((frame) => frame.id === currentFrame) ? currentFrame : next.frames[0]!.id);
      setColorIndex((currentColor) => Math.min(currentColor, next.palette.length - 1));
    } else {
      replaceDocument(next, !initialHydration && !purpose && (externalEdit || !sameEditableContent(current, next)));
    }
    setNotice(`Session synced at revision ${next.revision}.`);
  }, [replaceDocument, setKeyboardTarget]));
  sessionPersistenceRef.current = { status: session.status, ...(session.token ? { token: session.token } : {}) };
  const sessionSendPatchRef = useRef(session.sendPatch);
  sessionSendPatchRef.current = session.sendPatch;
  const sessionSendContextRef = useRef(session.sendContext);
  sessionSendContextRef.current = session.sendContext;

  useEffect(() => {
    if (session.status === "connected" && session.token) autosaveRef.current?.retry();
  }, [session.status, session.token]);

  const activeClip = project.clips.find((clip) => clip.id === project.active?.clipId) ?? project.clips[0]!;
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0];
  const appliedSettings = settingsFromDocument(project.document, defaultSettings);
  const settingsChanged = Boolean(activeSource) && !settingsEqual(draftSettings, appliedSettings);
  const previewForActiveSource = conversionPreview
    && conversionPreview.sourceId === activeSource?.id
    ? conversionPreview
    : undefined;
  const displayDocument = previewForActiveSource?.document ?? pixelDocument;
  const displayLayer = displayDocument.layers.find((layer) => layer.id === activeLayerId) ?? displayDocument.layers[0]!;
  const displayLayerId = displayLayer.id;
  const displayFrame = displayDocument.frames.find((frame) => frame.id === activeFrameId) ?? displayDocument.frames[0]!;
  const displayFrameId = displayFrame.id;
  const lightingFrameIds = activeClip.frameIds.filter((frameId) => displayDocument.frames.some((frame) => frame.id === frameId));
  const resolvedDisplayLight = resolveFrameLighting(
    displayDocument,
    lightingFrameIds.includes(displayFrameId) ? lightingFrameIds : displayDocument.frames.map((frame) => frame.id),
    displayFrameId
  );
  const lightingKeyframeCount = activeClip.frameIds.filter((frameId) => pixelDocument.frames.find((frame) => frame.id === frameId)?.lighting).length;
  const lightingMotionEnabled = lightingKeyframeCount > 1 || activeClip.frameIds.some((frameId) => pixelDocument.frames.find((frame) => frame.id === frameId)?.lightingInterpolation !== undefined);
  const displayFrameLabel = `Frame ${Math.max(0, displayDocument.frames.findIndex((frame) => frame.id === displayFrameId)) + 1}`;
  const showClipInProjectContext = project.clips.length > 1 || activeClip.name !== "Clip 1";
  const activeOriginalFrame = activeSource ? sourceFrameFor(activeSource, displayFrameId) : undefined;
  const sourceThumbnailUrl = activeSource ? sourceFramesFor(activeSource)[0]?.sourceUrl : undefined;
  const selectedColorUsage = countPaletteColorUsage(pixelDocument, colorIndex);
  const currentColorUsage = countPaletteColorUsageInFrame(pixelDocument, colorIndex, displayLayerId, displayFrameId);

  useEffect(() => {
    if (!workspaceReady || !sessionId || session.status !== "connected") return;
    sessionSendContextRef.current({
      projectId: project.id,
      projectName: project.name,
      projectRevision: project.revision,
      clipId: activeClip.id,
      clipName: activeClip.name,
      frameId: displayFrameId,
      layerId: displayLayerId,
      layerName: displayLayer.name
    });
  }, [activeClip.id, activeClip.name, displayFrameId, displayLayer.name, displayLayerId, project.id, project.name, project.revision, session.status, sessionId, workspaceReady]);

  useEffect(() => {
    setLight({ ...resolvedDisplayLight });
  }, [displayFrameId, resolvedDisplayLight.ambient, resolvedDisplayLight.height, resolvedDisplayLight.intensity, resolvedDisplayLight.shading, resolvedDisplayLight.toonSteps, resolvedDisplayLight.x, resolvedDisplayLight.y]);

  useEffect(() => {
    if (conversionSettingsRequest === handledConversionSettingsRequestRef.current) return;
    const sourceFrames = activeSource
      ? sourceFramesInDocumentOrder(activeSource, pixelDocument)
      : [];
    if (!settingsChanged || sourceFrames.length === 0 || !activeSource) {
      handledConversionSettingsRequestRef.current = conversionSettingsRequest;
      setConversionPreview(undefined);
      setIsPreviewing(false);
      pendingConversionActorRef.current = "user";
      return;
    }
    if (!sessionId || session.status !== "connected") {
      setIsPreviewing(false);
      return;
    }

    handledConversionSettingsRequestRef.current = conversionSettingsRequest;
    const requestId = ++previewRequestRef.current;

    const timer = window.setTimeout(() => {
      setIsPreviewing(true);
      setNotice("Updating the conversion preview…");
      const files = sourceFrames.map((frame) => new File([frame.sourceBlob], frame.name, { type: frame.mimeType }));
      const existingFrames = structuredClone(documentRef.current.frames);
      void convertFiles(files, draftSettings, sessionId, session.token).then((results) => {
        if (previewRequestRef.current !== requestId || results.length === 0) return;
        const previewDocument = mergeFrameDocuments(
          results.map((result) => result.document),
          sourceFrames.map((frame) => frame.frameId),
          existingFrames
        );
        setConversionPreview({
          document: previewDocument,
          sourceId: activeSource.id,
          settings: cloneSettings(draftSettings)
        });
        const patch = createDocumentPatch(documentRef.current, previewDocument, `Preview ${activeSource.name} conversion`);
        sessionDocumentPurposeRef.current = "conversion";
        replaceDocument(patch.after, true);
        sessionSendPatchRef.current(patch, pendingConversionActorRef.current);
        pendingConversionActorRef.current = "user";
        setNotice(`Updated the canvas from ${activeSource.name}. The project will save automatically.`);
      }).catch((error) => {
        if (previewRequestRef.current !== requestId) return;
        setConversionPreview(undefined);
        setNotice(error instanceof Error ? error.message : "The conversion preview failed.");
      }).finally(() => {
        pendingConversionActorRef.current = "user";
        if (previewRequestRef.current === requestId) setIsPreviewing(false);
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [activeSource, conversionSettingsRequest, draftSettings, pixelDocument, replaceDocument, session.status, session.token, sessionId, settingsChanged]);

  useEffect(() => {
    let disposed = false;
    let loadedProject: PixelProject | undefined;
    let loadedSavedRevision = -1;
    void loadWorkspace(workspaceLoadKey).then((snapshot) => {
      if (disposed || !snapshot) return;
      const restored = restoreSourceUrls(snapshot.sources);
      const recoveredProject = structuredClone(snapshot.project);
      if (sessionId && sessionHydratedRef.current) recoveredProject.document = structuredClone(documentRef.current);
      const recoveredDocument = recoveredProject.document;
      loadedProject = recoveredProject;
      loadedSavedRevision = snapshot.savedRevision ?? recoveredProject.revision;
      projectRef.current = recoveredProject;
      activeIdsRef.current = snapshot.activeSourceId ? { sourceId: snapshot.activeSourceId } : {};
      setProject(recoveredProject);
      documentRef.current = recoveredDocument;
      setPixelDocument(recoveredDocument);
      setActiveLayerId(recoveredProject.active?.layerId ?? recoveredDocument.layers[0]!.id);
      setActiveFrameId(recoveredProject.active?.frameId ?? recoveredDocument.frames[0]!.id);
      setDraftSettings(snapshot.draftSettings);
      setCustomCanvas(!(snapshot.draftSettings.canvasWidth === snapshot.draftSettings.canvasHeight && standardCanvasSizes.includes(snapshot.draftSettings.canvasWidth)));
      setSources(restored);
      setActiveSourceId(snapshot.activeSourceId);
      setInspectorTab(["convert", "edit", "frames"].includes(snapshot.activeInspectorTab) ? snapshot.activeInspectorTab : "convert");
      setNotice("Recovered this tab's project.");
    }).catch(() => {
      if (!disposed) setNotice("The editor opened, but this tab's cached source could not be recovered.");
    }).finally(() => {
      if (!disposed) {
        const initialSavedRevision = loadedProject ? loadedSavedRevision : -1;
        const queue = configureAutosave(initialSavedRevision);
        setWorkspaceReady(true);
        if ((!sessionId || sessionHydratedRef.current)
          && (!loadedProject || projectRef.current.revision > initialSavedRevision)) queue.enqueue(projectRef.current);
        if (workspaceHandoffId) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("workspace");
          window.history.replaceState(null, "", cleanUrl);
        }
      }
    });
    return () => { disposed = true; };
  }, [configureAutosave, sessionId, workspaceHandoffId, workspaceLoadKey]);

  useEffect(() => {
    const queue = autosaveRef.current;
    if (!workspaceReady || !queue || (sessionId && !sessionHydratedRef.current)) return;
    if (sessionId && session.pendingDocumentPatches > 0) return;
    const newestQueued = queue.state.pendingRevision ?? queue.state.savedRevision;
    if (project.revision > newestQueued) queue.enqueue(project);
  }, [project, session.pendingDocumentPatches, session.status, sessionId, workspaceReady]);

  const commit = useCallback((operation: (document: PixelDocument) => Patch): Patch | undefined => {
    try {
      const current = documentRef.current;
      const patch = operation(current);
      if ((patch.kind === "pixels" || patch.kind === "normal-pixels") && patch.changes.length === 0) return undefined;
      if (sessionId) {
        if (session.status === "conflict" || (session.status === "connecting" && !sessionHydratedRef.current)) {
          setNotice(session.status === "conflict" ? "Resolve the local session conflict before editing." : "Wait for the local session to connect before editing.");
          return undefined;
        }
        const next = session.status === "connected"
          ? applyPatch(current, patch)
          : historyRef.current.apply(current, patch);
        replaceDocument(next, true);
        session.sendPatch(patch, webCommandActorRef.current);
        setNotice(session.status === "connected" ? `${patch.reason} sent to the local session.` : `${patch.reason} queued until the local session reconnects.`);
        return patch;
      }
      replaceDocument(historyRef.current.apply(current, patch), true);
      setNotice(patch.reason);
      return patch;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The edit could not be applied.");
      return undefined;
    }
  }, [replaceDocument, session, sessionId]);

  const copySelectedPixels = useCallback(() => {
    const document = documentRef.current;
    const selection = document.selection;
    if (!selection) {
      setNotice("Select an area before copying pixels.");
      return undefined;
    }
    const source = editMap === "normal"
      ? getNormalPixels(document, selection.layerId, selection.frameId)
      : getPixels(document, selection.layerId, selection.frameId);
    const pixels: number[] = [];
    const selectedIndices = selection.type === "mask" ? new Set(selection.indices) : undefined;
    const selectedOffsets: number[] = [];
    const emptyValue = editMap === "normal" ? NEUTRAL_NORMAL : document.transparentColorIndex;
    for (let y = 0; y < selection.height; y += 1) {
      for (let x = 0; x < selection.width; x += 1) {
        const sourceIndex = (selection.y + y) * document.canvas.width + selection.x + x;
        const selected = !selectedIndices || selectedIndices.has(sourceIndex);
        pixels.push(selected ? source[sourceIndex]! : emptyValue);
        if (selectedIndices?.has(sourceIndex)) selectedOffsets.push(y * selection.width + x);
      }
    }
    const copied: PixelClipboard = {
      documentId: document.id,
      map: editMap,
      layerId: selection.layerId,
      frameId: selection.frameId,
      sourceX: selection.x,
      sourceY: selection.y,
      width: selection.width,
      height: selection.height,
      pixels,
      ...(selectedIndices ? { selectedOffsets } : {}),
      pasteOffset: 1
    };
    pixelClipboardRef.current = copied;
    clipboardKindRef.current = "pixels";
    setNotice(`Copied ${selection.width}×${selection.height} ${editMap === "normal" ? "normal " : ""}pixels. Press ⌘V or Ctrl+V to paste.`);
    return copied;
  }, [editMap]);

  const pasteCopiedPixels = useCallback(() => {
    const copied = pixelClipboardRef.current;
    const current = documentRef.current;
    if (!copied) {
      setNotice("Copy a selected area before pasting pixels.");
      return;
    }
    if (copied.documentId !== current.id) {
      setNotice("Copy the selection again after switching documents.");
      return;
    }
    if (copied.map === "color" && copied.pixels.some((colorIndex) => colorIndex >= current.palette.length)) {
      setNotice("The copied colors no longer match this palette. Copy the selection again.");
      return;
    }
    const selection = current.selection;
    const destinationSelection = selection
      && !selectionMatchesClipboardSource(selection, copied, current.canvas.width)
      ? selection
      : undefined;
    const stampSelection = destinationSelection && copied.width === 1 && copied.height === 1
      ? destinationSelection
      : undefined;
    const targetX = Math.min(
      Math.max(0, destinationSelection ? destinationSelection.x : copied.sourceX + copied.pasteOffset),
      current.canvas.width - 1
    );
    const targetY = Math.min(
      Math.max(0, destinationSelection ? destinationSelection.y : copied.sourceY + copied.pasteOffset),
      current.canvas.height - 1
    );
    const targetWidth = Math.min(copied.width, current.canvas.width - targetX);
    const targetHeight = Math.min(copied.height, current.canvas.height - targetY);
    const targetLayerId = destinationSelection?.layerId ?? copied.layerId;
    const targetFrameId = destinationSelection?.frameId ?? copied.frameId;
    const layer = current.layers.find((candidate) => candidate.id === targetLayerId);
    if (!layer?.frames[targetFrameId]) {
      setNotice("The paste destination is no longer available. Select the destination again.");
      return;
    }
    commit((document) => {
      const next = structuredClone(document);
      const targetLayer = next.layers.find((candidate) => candidate.id === targetLayerId);
      if (!targetLayer?.frames[targetFrameId]) throw new Error("The paste destination is no longer available.");
      if (copied.map === "normal") {
        const pixelCount = next.canvas.width * next.canvas.height;
        targetLayer.normalFrames ??= Object.fromEntries(next.frames.map((frame) => [
          frame.id,
          new Array<number>(pixelCount).fill(NEUTRAL_NORMAL)
        ]));
        targetLayer.normalFrames[targetFrameId] ??= new Array<number>(pixelCount).fill(NEUTRAL_NORMAL);
      }
      const target = copied.map === "normal"
        ? targetLayer.normalFrames![targetFrameId]!
        : targetLayer.frames[targetFrameId]!;
      if (stampSelection) {
        const pixelValue = copied.pixels[0]!;
        for (const index of selectedPixelIndices(stampSelection, next.canvas.width)) target[index] = pixelValue;
        next.selection = structuredClone(stampSelection);
        return createDocumentPatch(document, next, copied.map === "normal" ? "Paste normal selection" : "Paste selection");
      }
      const selectedOffsets = copied.selectedOffsets ? new Set(copied.selectedOffsets) : undefined;
      const pastedIndices: number[] = [];
      for (let y = 0; y < targetHeight; y += 1) {
        for (let x = 0; x < targetWidth; x += 1) {
          if (selectedOffsets && !selectedOffsets.has(y * copied.width + x)) continue;
          pastedIndices.push((targetY + y) * next.canvas.width + targetX + x);
          target[(targetY + y) * next.canvas.width + targetX + x] = copied.pixels[y * copied.width + x]!;
        }
      }
      const selectionBounds = {
        x: targetX,
        y: targetY,
        width: targetWidth,
        height: targetHeight,
        layerId: targetLayerId,
        frameId: targetFrameId
      };
      next.selection = selectedOffsets
        ? { type: "mask", ...selectionBounds, indices: pastedIndices }
        : { type: "rect", ...selectionBounds };
      return createDocumentPatch(document, next, copied.map === "normal" ? "Paste normal selection" : "Paste selection");
    });
    copied.pasteOffset += 1;
    setNotice(`Pasted ${copied.width}×${copied.height} ${copied.map === "normal" ? "normal " : ""}pixels.`);
  }, [commit]);

  const clearSelectedPixels = useCallback((reason = "Clear selection") => {
    const selection = documentRef.current.selection;
    if (!selection) return false;
    commit((document) => {
      const patch = clearSelection(document, selection);
      return reason === patch.reason ? patch : { ...patch, reason };
    });
    return true;
  }, [commit]);

  const resetSelectedNormals = useCallback((reason = "Reset selected normals") => {
    const selection = documentRef.current.selection;
    if (!selection) return false;
    commit((document) => {
      const patch = clearNormalSelection(document, selection);
      return reason === patch.reason ? patch : { ...patch, reason };
    });
    return true;
  }, [commit]);

  const cutSelectedPixels = useCallback(() => {
    const copied = copySelectedPixels();
    if (!copied) return undefined;
    if (copied.map === "normal") resetSelectedNormals("Cut normal selection");
    else clearSelectedPixels("Cut selection");
    return copied;
  }, [clearSelectedPixels, copySelectedPixels, resetSelectedNormals]);

  const copyActiveLayer = useCallback(() => {
    const document = documentRef.current;
    const layer = document.layers.find((candidate) => candidate.id === activeLayerId);
    if (!layer) return false;
    layerClipboardRef.current = { documentId: document.id, layer: structuredClone(layer) };
    clipboardKindRef.current = "layer";
    setNotice(`Copied layer ${layer.name}. Press ⌘V or Ctrl+V to duplicate it.`);
    return true;
  }, [activeLayerId]);

  const pasteCopiedLayer = useCallback(() => {
    const copied = layerClipboardRef.current;
    const current = documentRef.current;
    if (!copied) {
      setNotice("Copy a layer before pasting it.");
      return false;
    }
    if (copied.documentId !== current.id) {
      setNotice("Copy the layer again after switching documents.");
      return false;
    }
    const patch = commit((document) => pasteLayer(document, copied.layer));
    if (patch?.kind === "document") {
      const duplicate = patch.after.layers.at(-1);
      if (duplicate) setActiveLayerId(duplicate.id);
      setNotice(`Pasted layer ${copied.layer.name}.`);
      return true;
    }
    return false;
  }, [commit]);

  const copyActiveFrame = useCallback(() => {
    const document = documentRef.current;
    const frameIndex = document.frames.findIndex((frame) => frame.id === activeFrameId);
    if (frameIndex < 0) return false;
    frameClipboardRef.current = { documentId: document.id, frameId: activeFrameId };
    clipboardKindRef.current = "frame";
    setNotice(`Copied Frame ${frameIndex + 1}. Press ⌘V or Ctrl+V to duplicate it.`);
    return true;
  }, [activeFrameId]);

  const pasteCopiedFrame = useCallback(() => {
    const copied = frameClipboardRef.current;
    const current = documentRef.current;
    if (!copied) {
      setNotice("Copy a frame before pasting it.");
      return false;
    }
    if (copied.documentId !== current.id) {
      setNotice("Copy the frame again after switching documents.");
      return false;
    }
    if (!current.frames.some((frame) => frame.id === copied.frameId)) {
      setNotice("The copied frame is no longer available. Copy it again.");
      return false;
    }
    const patch = commit((document) => duplicateFrame(document, copied.frameId));
    if (patch?.kind !== "document") return false;
    const duplicate = patch.after.frames.at(-1);
    if (!duplicate) return false;
    setActiveFrameId(duplicate.id);
    setKeyboardTarget("frames");
    setNotice(`Pasted as Frame ${patch.after.frames.length}.`);
    return true;
  }, [commit, setKeyboardTarget]);

  const copyEditorTarget = useCallback(() => {
    if (documentRef.current.selection) return Boolean(copySelectedPixels());
    if (keyboardTargetRef.current === "frames") return copyActiveFrame();
    if (keyboardTargetRef.current === "layers") return copyActiveLayer();
    setNotice("Select pixels, a layer, or a frame before copying.");
    return false;
  }, [copyActiveFrame, copyActiveLayer, copySelectedPixels]);

  const cutEditorTarget = useCallback(() => {
    if (documentRef.current.selection) return Boolean(cutSelectedPixels());
    setNotice("Cut is available when pixels are selected.");
    return false;
  }, [cutSelectedPixels]);

  const pasteEditorClipboard = useCallback(() => {
    if (clipboardKindRef.current === "pixels") {
      pasteCopiedPixels();
      return true;
    }
    if (clipboardKindRef.current === "layer") return pasteCopiedLayer();
    if (clipboardKindRef.current === "frame") return pasteCopiedFrame();
    setNotice("Copy pixels, a layer, or a frame before pasting.");
    return false;
  }, [pasteCopiedFrame, pasteCopiedLayer, pasteCopiedPixels]);

  const removeActiveLayerFromKeyboard = useCallback(() => {
    const current = documentRef.current;
    if (current.layers.length === 1) {
      setNotice("A document must keep at least one layer.");
      return false;
    }
    const displayedLayers = [...current.layers].reverse();
    const activeIndex = displayedLayers.findIndex((layer) => layer.id === activeLayerId);
    const nextLayer = displayedLayers[activeIndex + 1] ?? displayedLayers[activeIndex - 1];
    const patch = commit((document) => removeLayer(document, activeLayerId));
    if (patch && nextLayer) setActiveLayerId(nextLayer.id);
    return Boolean(patch);
  }, [activeLayerId, commit]);

  const removeActiveFrameFromKeyboard = useCallback(() => {
    const current = documentRef.current;
    if (current.frames.length === 1) {
      setNotice("A document must keep at least one frame.");
      return false;
    }
    if (activeClip.frameIds.length === 1) {
      setNotice("A clip must keep at least one frame. Delete the clip instead.");
      return false;
    }
    const activeIndex = activeClip.frameIds.indexOf(activeFrameId);
    const nextFrameId = activeClip.frameIds[activeIndex + 1] ?? activeClip.frameIds[activeIndex - 1];
    const patch = commit((document) => {
      const removedWasOnlyKeyframe = Boolean(document.frames.find((frame) => frame.id === activeFrameId)?.lighting)
        && activeClip.frameIds.filter((frameId) => document.frames.find((frame) => frame.id === frameId)?.lighting).length === 1;
      if (!removedWasOnlyKeyframe || !nextFrameId) return removeFrame(document, activeFrameId);
      const fallbackLighting = resolveFrameLighting(document, activeClip.frameIds, nextFrameId);
      const next = removeFrame(document, activeFrameId).after;
      const fallbackFrame = next.frames.find((frame) => frame.id === nextFrameId)!;
      fallbackFrame.lighting = fallbackLighting;
      fallbackFrame.lightingInterpolation = "hold";
      return createDocumentPatch(document, next, "Remove frame");
    });
    if (patch && nextFrameId) setActiveFrameId(nextFrameId);
    if (patch) setPlaying(false);
    return Boolean(patch);
  }, [activeClip.frameIds, activeFrameId, commit]);

  const setSelection = useCallback((selection: Selection | undefined) => {
    const current = documentRef.current;
    if (JSON.stringify(current.selection) === JSON.stringify(selection)) return;
    const next = structuredClone(current);
    if (selection) next.selection = selection;
    else delete next.selection;
    const patch = createDocumentPatch(current, next, selection ? "Set selection" : "Clear selection");
    replaceDocument(sessionId && session.status !== "reconnecting" ? patch.after : historyRef.current.apply(current, patch), false);
    session.sendSelection(selection);
  }, [replaceDocument, session, sessionId]);

  const selectPixelsUsingColor = useCallback(() => {
    const document = documentRef.current;
    const pixels = getPixels(document, displayLayerId, displayFrameId);
    const indices = pixels.flatMap((pixel, index): number[] => pixel === colorIndex ? [index] : []);
    if (indices.length === 0) {
      setNotice(`Color ${colorIndex} is not used in the current layer and frame.`);
      return;
    }
    const bounds = boundsForPixelIndices(indices, document.canvas.width);
    setSelection({
      type: "mask",
      ...bounds,
      layerId: displayLayerId,
      frameId: displayFrameId,
      indices
    });
    setTool("select");
    setNotice(`Selected ${indices.length.toLocaleString()} pixels using color ${colorIndex}.`);
  }, [colorIndex, displayFrameId, displayLayerId, setSelection]);

  const undo = useCallback(() => {
    const current = documentRef.current;
    const next = historyRef.current.undo(current);
    if (next !== current) {
      const contentChanged = !sameEditableContent(current, next);
      replaceDocument(next, contentChanged);
      if (sessionId && session.status === "reconnecting") {
        session.sendPatch(createDocumentPatch(current, next, "Undo queued edit"), webCommandActorRef.current);
      }
      setNotice("Undo");
    } else if (sessionId) session.requestUndo();
  }, [replaceDocument, session, sessionId]);

  const redo = useCallback(() => {
    const current = documentRef.current;
    const next = historyRef.current.redo(current);
    if (next !== current) {
      const contentChanged = !sameEditableContent(current, next);
      replaceDocument(next, contentChanged);
      if (sessionId && session.status === "reconnecting") {
        session.sendPatch(createDocumentPatch(current, next, "Redo queued edit"), webCommandActorRef.current);
      }
      setNotice("Redo");
    } else if (sessionId) session.requestRedo();
  }, [replaceDocument, session, sessionId]);

  useEffect(() => {
    if (!activeOriginalFrame?.sourceUrl) setCompareMode(false);
  }, [activeOriginalFrame?.sourceUrl]);

  useEffect(() => {
    if (editMap === "normal") {
      setCompareMode(false);
      setColorPickTarget(undefined);
    }
  }, [editMap]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(false);
    };
    const blur = () => setShiftPressed(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      const command = event.metaKey || event.ctrlKey;
      const shiftedDigit = event.code.match(/^Digit([012])$/)?.[1]
        ?? ({ "!": "1", "@": "2", ")": "0" } as Record<string, string>)[event.key]
        ?? event.key;
      if (typing) return;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (typeof window.document.execCommand !== "function" || !window.document.execCommand("copy")) copyEditorTarget();
        return;
      }
      if (command && event.key.toLowerCase() === "x") {
        event.preventDefault();
        if (typeof window.document.execCommand !== "function" || !window.document.execCommand("cut")) {
          const copied = documentRef.current.selection ? cutSelectedPixels() : undefined;
          if (!copied) cutEditorTarget();
          if (copied) void navigator.clipboard?.writeText(serializePixelClipboard(copied)).catch(() => undefined);
        }
        return;
      }
      if (command && event.key.toLowerCase() === "v" && clipboardKindRef.current) {
        if (typeof window.ClipboardEvent !== "function") {
          event.preventDefault();
          pasteEditorClipboard();
          return;
        }
        if (pasteFallbackRef.current !== undefined) window.clearTimeout(pasteFallbackRef.current);
        pasteFallbackRef.current = window.setTimeout(() => {
          pasteFallbackRef.current = undefined;
          pasteEditorClipboard();
        }, 0);
        return;
      }
      if (!command && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (documentRef.current.selection) {
          event.preventDefault();
          if (editMap === "normal") resetSelectedNormals();
          else clearSelectedPixels();
          return;
        }
        if (keyboardTargetRef.current === "frames") {
          event.preventDefault();
          removeActiveFrameFromKeyboard();
          return;
        }
        if (keyboardTargetRef.current === "layers") {
          event.preventDefault();
          removeActiveLayerFromKeyboard();
        }
        return;
      }
      if (event.key === "Escape") {
        if (colorPickTarget) {
          setColorPickTarget(undefined);
          setNotice("Color picking cancelled.");
        } else if (compareMode) setCompareMode(false);
        else if (documentRef.current.selection) setSelection(undefined);
        else setTool("select");
        return;
      }
      if (event.shiftKey && shiftedDigit === "1") {
        event.preventDefault(); setFitRequest((current) => current + 1);
      } else if (event.shiftKey && shiftedDigit === "2") {
        event.preventDefault(); setSelectionFitRequest((current) => current + 1);
      } else if (event.shiftKey && shiftedDigit === "0") {
        event.preventDefault(); setZoom(1);
      } else if (!command && !event.altKey) {
        const selected = toolLabels.find((candidate) => candidate.key.toLowerCase() === event.key.toLowerCase());
        if (selected) setTool(selected.value);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [clearSelectedPixels, colorPickTarget, compareMode, copyEditorTarget, cutEditorTarget, cutSelectedPixels, editMap, pasteEditorClipboard, redo, removeActiveFrameFromKeyboard, removeActiveLayerFromKeyboard, resetSelectedNormals, setSelection, undo]);

  useEffect(() => {
    if (!playing || activeClip.frameIds.length < 2) return;
    const frame = pixelDocument.frames.find((candidate) => candidate.id === activeFrameId)
      ?? pixelDocument.frames.find((candidate) => candidate.id === activeClip.frameIds[0])!;
    const timer = window.setTimeout(() => {
      const index = activeClip.frameIds.indexOf(frame.id);
      setActiveFrameId(activeClip.frameIds[(index + 1) % activeClip.frameIds.length]!);
    }, frame.durationMs);
    return () => window.clearTimeout(timer);
  }, [activeClip.frameIds, activeFrameId, pixelDocument.frames, playing]);

  const sendDocument = useCallback((next: PixelDocument, reason: string, purpose: "load" | "conversion") => {
    historyRef.current = new PatchHistory();
    if (sessionId) {
      if (session.status !== "connected") throw new Error("Wait for the local session to reconnect first.");
      const patch = createDocumentPatch(documentRef.current, next, reason);
      sessionDocumentPurposeRef.current = purpose;
      replaceDocument(patch.after, false);
      session.sendPatch(patch, webCommandActorRef.current);
    } else replaceDocument(next, false);
  }, [replaceDocument, session, sessionId]);

  const cancelPendingConversion = useCallback(() => {
    previewRequestRef.current += 1;
    setConversionPreview(undefined);
    setIsPreviewing(false);
  }, []);

  const performImport = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    if (sessionId && session.status !== "connected") return setNotice("Wait for the local session to reconnect before importing.");
    cancelPendingConversion();
    setIsImporting(true);
    setNotice(`Converting ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const imageFiles: File[] = [];
      const documentFiles: File[] = [];
      for (const file of files) {
        if (file.name.endsWith(".pixel.json") || file.type === "application/json") {
          documentFiles.push(file);
        } else imageFiles.push(file);
      }
      if (documentFiles.length > 1 || (documentFiles.length > 0 && imageFiles.length > 0)) {
        throw new Error("Replace the canvas with one Pixel JSON, or choose only images for a frame sequence.");
      }
      let imported: Awaited<ReturnType<typeof createImportedProjectContent>>;
      if (documentFiles[0]) {
        imported = await createImportedProjectContent(documentFiles[0], parsePixelDocument(await documentFiles[0].text()));
      } else if (imageFiles.length > 0) {
        const results = await convertFiles(imageFiles, draftSettings, sessionId, session.token);
        const document = mergeFrameDocuments(results.map((result) => result.document));
        imported = imageFiles.length > 1
          ? await createImportedSequenceProjectContent(imageFiles, document)
          : await createImportedProjectContent(imageFiles[0]!, document);
      } else throw new Error("No supported source was found.");
      for (const source of sourcesRef.current) revokeSourceUrls(source);
      setSources([imported.source]);
      setActiveSourceId(imported.source.id);
      activeIdsRef.current = { sourceId: imported.source.id };
      commitProjectState((draft) => {
        draft.sources = [structuredClone(imported.metadata)];
        draft.document = structuredClone(imported.document);
        const clipId = syncProjectClips(draft, imported.document, draft.active?.clipId);
        draft.active = {
          clipId,
          frameId: imported.document.frames[0]!.id,
          layerId: imported.document.layers[0]!.id
        };
      });
      sendDocument(imported.document, `Replace canvas from ${imported.source.name}`, "conversion");
      if (imageFiles.length > 1) {
        setInspectorTab("frames");
        setNotice(`${imageFiles.length} images are ready as one animation with ${imageFiles.length} frames.`);
      } else {
        setNotice(`Replaced the canvas from ${imported.source.name}. The project will save automatically.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed.");
      if (webCommandActorRef.current === "ai") throw error;
    } finally { setIsImporting(false); }
  }, [cancelPendingConversion, commitProjectState, draftSettings, sendDocument, session.status, session.token, sessionId]);

  const requestImport = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const imageFiles = naturalSortFiles(files.filter((file) => file.type.startsWith("image/")));
    const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
    setPendingImport({ imageFiles, otherFiles });
  }, []);

  const importFramesIntoCurrent = useCallback(async (files: File[]) => {
    const imageFiles = naturalSortFiles(files.filter((file) => file.type.startsWith("image/")));
    if (imageFiles.length === 0) return setNotice("Choose one or more PNG, WebP, or JPEG images.");
    if (sessionId && session.status !== "connected") return setNotice("Wait for the local session to reconnect before importing frames.");
    cancelPendingConversion();
    setIsImporting(true);
    setNotice(`Adding ${imageFiles.length} frame${imageFiles.length === 1 ? "" : "s"}…`);
    try {
      const settings = {
        ...draftSettings,
        canvasWidth: pixelDocument.canvas.width,
        canvasHeight: pixelDocument.canvas.height,
        colorCount: pixelDocument.palette.length,
        palette: [...pixelDocument.palette]
      };
      const results = await convertFiles(imageFiles, settings, sessionId, session.token);
      const frameIds = results.map(() => `frame-${crypto.randomUUID()}`);
      const next = appendFrameDocuments(documentRef.current, results.map((result) => result.document), frameIds);
      const sourceId = `source-${crypto.randomUUID()}`;
      const sourceName = sequenceSourceName(imageFiles);
      const sourceMetadata = await createEmbeddedSequenceProjectSource(imageFiles, sourceName, sourceId, frameIds);
      const current = documentRef.current;
      const patch = createDocumentPatch(current, next, `Add ${results.length} image frame${results.length === 1 ? "" : "s"}`);
      const nextDocument = sessionId ? patch.after : historyRef.current.apply(current, patch);
      const sourceFrames = imageFiles.map((file, index) => createSourceFrame(file, frameIds[index]!));
      const runtimeSource: SourceAsset = {
        id: sourceId,
        name: sourceName,
        mimeType: sourceMetadata.mimeType,
        sourceFrames
      };
      replaceDocument(nextDocument, true, (draft) => { draft.sources.push(sourceMetadata); });
      if (sessionId) session.sendPatch(patch, webCommandActorRef.current);
      setSources((currentSources) => [...currentSources, runtimeSource]);
      setActiveSourceId(sourceId);
      activeIdsRef.current = { sourceId };
      setActiveFrameId(frameIds.at(-1)!);
      setInspectorTab("frames");
      setNotice(`Added ${results.length} image frame${results.length === 1 ? "" : "s"} to the current clip.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The frames could not be imported.");
      if (webCommandActorRef.current === "ai") throw error;
    } finally {
      setIsImporting(false);
    }
  }, [cancelPendingConversion, draftSettings, pixelDocument.palette, replaceDocument, session, sessionId]);

  const attachSources = useCallback(async (files: File[], replace: boolean) => {
    if (files.length === 0) return;
    if (replace && (!activeSource || files.length !== 1)) {
      setNotice("Choose one file and an existing source to replace.");
      return;
    }
    cancelPendingConversion();
    const retained = await Promise.all(files.map(async (file) => {
      const image = file.type.startsWith("image/");
      const metadata = await createEmbeddedProjectSource(file, image ? "image" : "pixel-json", undefined, undefined, image ? [activeFrameId] : []);
      return {
        metadata,
        runtime: {
          id: metadata.id,
          name: file.name,
          mimeType: file.type || (image ? "image/png" : "application/json"),
          ...(image
            ? { sourceFrames: [createSourceFrame(file, activeFrameId)] }
            : { sourceBlob: file, sourceUrl: URL.createObjectURL(file) })
        } satisfies SourceAsset
      };
    }));
    const removed = replace && activeSource ? activeSource : undefined;
    setSources((current) => [
      ...current.filter((source) => !removed || source.id !== removed.id),
      ...retained.map((source) => source.runtime)
    ]);
    commitProjectState((draft) => {
      if (removed) draft.sources = draft.sources.filter((source) => source.id !== removed.id);
      draft.sources.push(...retained.map((source) => source.metadata));
    });
    const selected = retained[0]!.runtime;
    setActiveSourceId(selected.id);
    activeIdsRef.current = { sourceId: selected.id };
    setProjectScopeOpen(true);
    if (removed) revokeSourceUrls(removed);
    setNotice(`${replace ? "Replaced" : "Added"} ${retained.length} Project source${retained.length === 1 ? "" : "s"}.`);
  }, [activeFrameId, activeSource, cancelPendingConversion, commitProjectState]);

  const importSpriteSheet = useCallback(async (file: File, columns: number, rows: number) => {
    if (sessionId && session.status !== "connected") return setNotice("Wait for the local session to reconnect before importing a sprite sheet.");
    cancelPendingConversion();
    setIsImporting(true);
    setNotice(`Splitting ${file.name} into ${columns * rows} frames…`);
    try {
      const tiles = await splitSpriteSheet(file, columns, rows);
      const settings = {
        ...draftSettings,
        canvasWidth: pixelDocument.canvas.width,
        canvasHeight: pixelDocument.canvas.height,
        colorCount: pixelDocument.palette.length,
        palette: [...pixelDocument.palette]
      };
      const results = await convertFiles(tiles, settings, sessionId, session.token);
      const frameIds = results.map(() => `frame-${crypto.randomUUID()}`);
      const next = appendFrameDocuments(documentRef.current, results.map((result) => result.document), frameIds);
      const sourceId = `source-${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      const sourceMetadata = await createEmbeddedProjectSource(file, "sprite-sheet", sourceId, createdAt);
      sourceMetadata.frames = await createEmbeddedProjectSourceFrames(tiles, frameIds);
      const runtime: SourceAsset = {
        id: sourceId,
        name: file.name,
        mimeType: file.type,
        sourceBlob: file,
        sourceUrl: URL.createObjectURL(file),
        sourceFrames: tiles.map((tile, index) => createSourceFrame(tile, frameIds[index]!))
      };
      const current = documentRef.current;
      const patch = createDocumentPatch(current, next, `Import ${file.name} sprite sheet`);
      const nextDocument = sessionId ? patch.after : historyRef.current.apply(current, patch);
      replaceDocument(nextDocument, true, (draft) => { draft.sources.push(sourceMetadata); });
      if (sessionId) session.sendPatch(patch, webCommandActorRef.current);
      setSources((current) => [...current, runtime]);
      setActiveSourceId(sourceId);
      activeIdsRef.current = { sourceId };
      setActiveFrameId(frameIds[0]!);
      setInspectorTab("frames");
      setNotice(`Imported ${columns * rows} frames from ${file.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The sprite sheet could not be imported.");
      if (webCommandActorRef.current === "ai") throw error;
    } finally {
      setIsImporting(false);
    }
  }, [cancelPendingConversion, draftSettings, pixelDocument.palette, replaceDocument, session, sessionId]);

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      if (typing) return;
      if (!documentRef.current.selection) {
        event.preventDefault();
        copyEditorTarget();
        return;
      }
      const copied = copySelectedPixels();
      if (!copied || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serializePixelClipboard(copied));
    };
    window.addEventListener("copy", onCopy);
    return () => window.removeEventListener("copy", onCopy);
  }, [copyEditorTarget, copySelectedPixels]);

  useEffect(() => {
    const onCut = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      if (typing) return;
      if (!documentRef.current.selection) {
        event.preventDefault();
        cutEditorTarget();
        return;
      }
      const copied = cutSelectedPixels();
      if (!copied || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serializePixelClipboard(copied));
    };
    window.addEventListener("cut", onCut);
    return () => window.removeEventListener("cut", onCut);
  }, [cutEditorTarget, cutSelectedPixels]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (pasteFallbackRef.current !== undefined) {
        window.clearTimeout(pasteFallbackRef.current);
        pasteFallbackRef.current = undefined;
      }
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      if (typing) return;
      const files = [...event.clipboardData?.files ?? []].filter((file) => file.type.startsWith("image/"));
      if (files.length > 0) {
        event.preventDefault();
        requestImport(files);
      } else if (clipboardKindRef.current) {
        event.preventDefault();
        pasteEditorClipboard();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
      if (pasteFallbackRef.current !== undefined) window.clearTimeout(pasteFallbackRef.current);
    };
  }, [pasteEditorClipboard, requestImport]);

  const selectSource = (sourceId: string) => {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    previewRequestRef.current += 1;
    setConversionPreview(undefined);
    setIsPreviewing(false);
    setDeleteTarget(undefined);
    setActiveSourceId(source.id);
    activeIdsRef.current = { sourceId: source.id };
    setNotice(`Selected ${source.name} as the retained source.`);
  };

  const removeSource = useCallback((sourceId: string) => {
    const source = sourcesRef.current.find((candidate) => candidate.id === sourceId);
    if (!source) return setDeleteTarget(undefined);
    const remainingSources = sourcesRef.current.filter((candidate) => candidate.id !== source.id);
    setSources(remainingSources);
    setDeleteTarget(undefined);
    if (source.sourceUrl) URL.revokeObjectURL(source.sourceUrl);
    for (const frame of source.sourceFrames ?? []) if (frame.sourceUrl) URL.revokeObjectURL(frame.sourceUrl);
    const fallbackSource = remainingSources[0];
    setActiveSourceId(fallbackSource?.id);
    activeIdsRef.current = fallbackSource ? { sourceId: fallbackSource.id } : {};
    commitProjectState((draft) => {
      draft.sources = draft.sources.filter((candidate) => candidate.id !== source.id);
    });
    setCompareMode(false);
    setNotice(`Removed ${source.name}. The canvas and its edits were kept.`);
  }, [commitProjectState]);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    removeSource(deleteTarget.sourceId);
  };

  const saveProjectAs = async (name: string) => {
    try {
      const saveState = await autosaveRef.current?.flush();
      if (saveState && saveState.status !== "saved") throw new Error("Wait for the current project to finish saving before using Save As.");
      const original = projectRef.current;
      const originalSnapshot = createWorkspaceSnapshot(original, draftSettingsRef.current, sourcesRef.current, activeSourceIdRef.current, inspectorTabRef.current, original.revision);
      await saveWorkspace(`project:${original.id}`, originalSnapshot);
      const clone = clonePixelProject(original, { name });
      const cloneSnapshot = createWorkspaceSnapshot(clone, draftSettingsRef.current, sourcesRef.current, activeSourceIdRef.current, inspectorTabRef.current, -1);
      await saveWorkspace(`project:${clone.id}`, cloneSnapshot);
      await saveWorkspace(workspaceKey, cloneSnapshot);
      projectRef.current = clone;
      setProject(clone);
      configureAutosave(-1).enqueue(clone);
      setNotice(`Created ${clone.name} as a new project. The original project was kept.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The project could not be copied.");
      if (webCommandActorRef.current === "ai") throw error;
    }
  };

  const renameProject = (name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === projectRef.current.name) return;
    if (nextName.length > 256) return setNotice("Project names cannot exceed 256 characters.");
    commitProjectState((draft) => { draft.name = nextName; });
    setNotice(`Renamed the project to ${nextName}.`);
  };

  const activateProject = async (
    incomingProject: PixelProject,
    incomingSources: SourceAsset[],
    savedRevision: number,
    persistAsNew: boolean,
    message: string
  ) => {
    const currentSaveState = await autosaveRef.current?.flush();
    if (currentSaveState && currentSaveState.status !== "saved") {
      throw new Error("The current project still has unsaved changes. Reconnect or resolve the save error before opening another project.");
    }
    let nextProject = structuredClone(incomingProject);
    let nextClip = nextProject.clips.find((clip) => clip.id === nextProject.active?.clipId) ?? nextProject.clips[0]!;
    let nextFrameId = nextClip.frameIds.includes(nextProject.active?.frameId ?? "")
      ? nextProject.active!.frameId!
      : nextClip.frameIds[0]!;
    let nextLayerId = nextProject.document.layers.some((layer) => layer.id === nextProject.active?.layerId)
      ? nextProject.active!.layerId!
      : nextProject.document.layers[0]!.id;

    if (sessionId) {
      if (session.status !== "connected") throw new Error("Wait for the local session to reconnect before opening another project.");
      const patch = createDocumentPatch(documentRef.current, nextProject.document, `Open ${nextProject.name}`);
      nextProject = structuredClone(nextProject);
      nextProject.document = patch.after;
      nextFrameId = patch.after.frames.some((frame) => frame.id === nextFrameId) ? nextFrameId : patch.after.frames[0]!.id;
      nextLayerId = patch.after.layers.some((layer) => layer.id === nextLayerId) ? nextLayerId : patch.after.layers[0]!.id;
      nextClip = nextProject.clips.find((clip) => clip.id === nextClip.id) ?? nextProject.clips[0]!;
      sessionDocumentPurposeRef.current = "load";
      session.sendPatch(patch, webCommandActorRef.current);
    }

    nextProject.active = {
      clipId: nextClip.id,
      frameId: nextFrameId,
      layerId: nextLayerId
    };
    for (const source of sourcesRef.current) revokeSourceUrls(source);
    historyRef.current = new PatchHistory();
    projectRef.current = nextProject;
    documentRef.current = nextProject.document;
    activeIdsRef.current = incomingSources[0] ? { sourceId: incomingSources[0].id } : {};
    setProject(nextProject);
    setPixelDocument(nextProject.document);
    setActiveFrameId(nextFrameId);
    setActiveLayerId(nextLayerId);
    setSources(incomingSources);
    const firstSource = incomingSources[0];
    setActiveSourceId(firstSource?.id);
    const nextSettings = settingsFromDocument(nextProject.document, defaultSettings);
    setDraftSettings(nextSettings);
    setCustomCanvas(!(nextSettings.canvasWidth === nextSettings.canvasHeight && standardCanvasSizes.includes(nextSettings.canvasWidth)));
    setInspectorTab("convert");
    setCompareMode(false);
    setPlaying(false);
    setKeyboardTarget("canvas");

    const queue = configureAutosave(persistAsNew ? -1 : savedRevision);
    const snapshot = createWorkspaceSnapshot(
      nextProject,
      nextSettings,
      incomingSources,
      firstSource?.id,
      "convert",
      persistAsNew ? -1 : savedRevision
    );
    await saveWorkspace(workspaceKey, snapshot);
    await saveWorkspace(`project:${nextProject.id}`, snapshot);
    if (persistAsNew) queue.enqueue(nextProject);
    setNotice(message);
  };

  const createNewProject = async (name: string) => {
    const next = createPixelProject({ name, width: defaultSettings.canvasWidth, height: defaultSettings.canvasHeight });
    await activateProject(next, [], -1, true, `Created ${next.name}. Changes will save automatically.`);
  };

  const openProjectFile = async (file: File) => {
    if (file.size > 64 * 1024 * 1024) throw new Error("Project files must be 64MB or smaller.");
    const next = parsePixelProject(new TextDecoder().decode(await readBlobBytes(file)));
    const restored = await restoreEmbeddedProjectSources(next);
    await activateProject(next, restored, -1, true, `Opened ${next.name} from ${file.name}.`);
  };

  const openRecentProject = async (projectId: string) => {
    const snapshot = await loadWorkspace(`project:${projectId}`);
    if (!snapshot) throw new Error("That recent project is no longer available in this browser.");
    const restored = restoreSourceUrls(snapshot.sources);
    await activateProject(
      snapshot.project,
      restored,
      snapshot.savedRevision ?? snapshot.project.revision,
      false,
      `Reopened ${snapshot.project.name}.`
    );
  };

  const savePreset = () => {
    const next = [...presets, structuredClone(draftSettings)].slice(-8);
    setPresets(next); localStorage.setItem("editable-pixel-presets", JSON.stringify(next));
    setNotice("Conversion preset saved in this browser.");
  };
  const loadPreset = (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    updateDraftSettings(() => structuredClone(preset));
    setCustomCanvas(!(preset.canvasWidth === preset.canvasHeight && standardCanvasSizes.includes(preset.canvasWidth)));
    setNotice(`Loaded conversion preset ${index + 1}. Reconvert to apply it.`);
  };
  const addFixedPaletteColor = (value: string): boolean => {
    if (!isHexColor(value)) {
      setNotice("Enter a six-digit hex color such as #B8FF3D.");
      return false;
    }
    const nextColor = `${value.toLowerCase()}ff`;
    if (draftSettings.palette?.some((color) => normalizePaletteColor(color) === nextColor)) {
      setNotice("That color is already in the fixed palette.");
      return false;
    }
    const nextPalette = [...draftSettings.palette ?? [], nextColor];
    updateDraftSettings((current) => ({
      ...current,
      palette: [...current.palette ?? [], nextColor]
    }));
    setNewFixedPaletteColor(colorInputValue(nextFixedPaletteColor(nextPalette)));
    return true;
  };
  const updateFixedPaletteColor = (index: number, value: string) => {
    const nextColor = `${value.toLowerCase()}ff`;
    if (draftSettings.palette?.some((color, colorIndex) => colorIndex !== index && normalizePaletteColor(color) === nextColor)) {
      setNotice("That color is already in the fixed palette.");
      return;
    }
    updateDraftSettings((current) => ({
      ...current,
      palette: current.palette?.map((color, colorIndex) => colorIndex === index ? nextColor : color)
    }));
  };
  const removeFixedPaletteColor = (index: number) => {
    updateDraftSettings((current) => {
      const palette = current.palette?.filter((_, colorIndex) => colorIndex !== index) ?? [];
      const next = { ...current };
      if (palette.length > 0) next.palette = palette;
      else delete next.palette;
      return next;
    });
  };
  const selectionAction = (action: SelectionAction) => {
    const selection = documentRef.current.selection;
    if (!selection) return setNotice("Make a selection first. Transparent cells are valid selection coordinates.");
    if (action === "move-left") commit((document) => moveSelection(document, selection, -1, 0));
    if (action === "move-right") commit((document) => moveSelection(document, selection, 1, 0));
    if (action === "move-up") commit((document) => moveSelection(document, selection, 0, -1));
    if (action === "move-down") commit((document) => moveSelection(document, selection, 0, 1));
    if (action === "copy") copySelectedPixels();
    if (action === "clear") commit((document) => clearSelection(document, selection));
    if (action === "flip-h") commit((document) => flipSelection(document, selection, "horizontal"));
    if (action === "flip-v") commit((document) => flipSelection(document, selection, "vertical"));
  };
  const addNewColor = (): boolean => {
    if (!isHexColor(newColor)) {
      setNotice("Enter a six-digit hex color such as #FFCF33.");
      return false;
    }
    const normalized = `${newColor.toLowerCase()}ff`;
    if (documentRef.current.palette.includes(normalized)) {
      setNotice("That color is already in the palette.");
      return false;
    }
    const nextIndex = documentRef.current.palette.length;
    commit((document) => addPaletteColor(document, normalized));
    setColorIndex(nextIndex);
    return true;
  };
  const setFramePreset = (preset: "tight" | "safe") => {
    updateDraftSettings((current) => ({ ...current, contentScale: preset === "tight" ? 1 : 0.8 }));
  };
  const setContentScalePercent = (percent: number) => {
    if (!Number.isFinite(percent)) return;
    const clamped = Math.min(100, Math.max(25, percent));
    updateDraftSettings((current) => ({ ...current, contentScale: clamped / 100 }));
  };
  const previewLighting = (changes: Partial<FrameLighting>) => {
    const next = { ...lightRef.current, ...changes };
    lightRef.current = next;
    setLight(next);
  };
  const setStaticClipLighting = (lighting: FrameLighting) => {
    commit((document) => {
      const next = structuredClone(document);
      for (const frameId of activeClip.frameIds) {
        const frame = next.frames.find((candidate) => candidate.id === frameId);
        if (!frame) continue;
        delete frame.lighting;
        delete frame.lightingInterpolation;
      }
      const firstFrame = next.frames.find((frame) => frame.id === activeClip.frameIds[0]);
      if (firstFrame) {
        firstFrame.lighting = { ...lighting };
        delete firstFrame.lightingInterpolation;
      }
      return createDocumentPatch(document, next, "Make clip lighting static");
    });
  };
  const commitLighting = (lighting: FrameLighting = lightRef.current) => {
    if (!lightingMotionEnabled) {
      setStaticClipLighting(lighting);
      return;
    }
    commit((document) => {
      const next = setFrameLighting(document, displayFrameId, lighting).after;
      const frame = next.frames.find((candidate) => candidate.id === displayFrameId)!;
      frame.lightingInterpolation ??= "ease-in-out";
      return createDocumentPatch(document, next, "Set lighting keyframe");
    });
  };
  const setLightingMotionEnabled = (enabled: boolean) => {
    if (!enabled) {
      setStaticClipLighting(lightRef.current);
      return;
    }
    commit((document) => {
      const next = structuredClone(document);
      let frame = next.frames.find((candidate) => candidate.id === displayFrameId)!;
      if (!frame.lighting) frame.lighting = resolveFrameLighting(document, activeClip.frameIds, displayFrameId);
      for (const frameId of activeClip.frameIds) {
        const keyframe = next.frames.find((candidate) => candidate.id === frameId);
        if (keyframe?.lighting) keyframe.lightingInterpolation = "ease-in-out";
      }
      frame = next.frames.find((candidate) => candidate.id === displayFrameId)!;
      frame.lightingInterpolation = "ease-in-out";
      return createDocumentPatch(document, next, "Animate clip lighting");
    });
  };
  const toggleLightingKeyframe = (frameId: string) => {
    const frame = documentRef.current.frames.find((candidate) => candidate.id === frameId);
    if (!frame) return;
    setActiveFrameId(frameId);
    setPlaying(false);
    if (frame.lighting) {
      if (lightingKeyframeCount <= 1) return;
      commit((document) => removeFrameLightingKeyframe(document, frameId, activeClip.frameIds));
      return;
    }
    commit((document) => {
      const next = setFrameLighting(document, frameId, resolveFrameLighting(document, activeClip.frameIds, frameId)).after;
      next.frames.find((candidate) => candidate.id === frameId)!.lightingInterpolation = "ease-in-out";
      return createDocumentPatch(document, next, "Add lighting keyframe");
    });
  };
  const changeLightingInterpolation = (frameId: string, interpolation: FrameLightingInterpolation) => {
    commit((document) => setFrameLightingInterpolation(document, frameId, interpolation));
  };
  const addNewFrame = () => {
    const patch = commit((document) => {
      const next = addFrame(
        document,
        `Frame ${document.frames.length + 1}`,
        displayFrame.durationMs,
        lightRef.current
      ).after;
      const added = next.frames.at(-1)!;
      delete added.lighting;
      delete added.lightingInterpolation;
      return createDocumentPatch(document, next, "Add frame");
    });
    if (patch?.kind !== "document") return;
    const added = patch.after.frames.at(-1);
    if (added) setActiveFrameId(added.id);
  };
  const selectClip = (clipId: string) => {
    const clip = project.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const frameId = clip.frameIds[0]!;
    commitProjectState((draft) => {
      draft.active = {
        clipId,
        frameId,
        layerId: activeLayerId
      };
    });
    setActiveFrameId(frameId);
    setKeyboardTarget("frames");
    setPlaying(false);
  };
  const addClip = () => {
    try {
      if (sessionId && session.status !== "connected") throw new Error("Wait for the local session to reconnect before adding a clip.");
      const current = documentRef.current;
      const clipNumber = project.clips.reduce((largest, clip) => {
        const match = /^Clip (\d+)$/.exec(clip.name);
        return match ? Math.max(largest, Number(match[1])) : largest;
      }, 0) + 1;
      const patch = addFrame(
        current,
        `Frame ${current.frames.length + 1}`,
        displayFrame.durationMs,
        lightRef.current
      );
      const nextDocument = sessionId ? patch.after : historyRef.current.apply(current, patch);
      const frameId = nextDocument.frames.at(-1)!.id;
      const clipId = `clip-${crypto.randomUUID()}`;
      replaceDocument(nextDocument, true, (draft) => {
        for (const clip of draft.clips) clip.frameIds = clip.frameIds.filter((id) => id !== frameId);
        draft.clips.push({ id: clipId, name: `Clip ${clipNumber}`, frameIds: [frameId] });
        draft.active = { clipId, frameId, layerId: activeLayerId };
      });
      if (sessionId) session.sendPatch(patch, webCommandActorRef.current);
      setActiveFrameId(frameId);
      setKeyboardTarget("frames");
      setPlaying(false);
      setNotice(`Created Clip ${clipNumber} with one blank frame.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The clip could not be created."); }
  };
  const renameActiveClip = (name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === activeClip.name) return;
    if (nextName.length > 256) return setNotice("Clip names cannot exceed 256 characters.");
    commitProjectState((draft) => {
      draft.clips.find((clip) => clip.id === activeClip.id)!.name = nextName;
    });
    setNotice(`Renamed the clip to ${nextName}.`);
  };
  const deleteActiveClip = () => {
    try {
      if (project.clips.length === 1) throw new Error("A Project must keep at least one clip.");
      if (sessionId && session.status !== "connected") throw new Error("Wait for the local session to reconnect before deleting a clip.");
      const fallback = project.clips.find((clip) => clip.id !== activeClip.id)!;
      const current = documentRef.current;
      let withoutClipFrames = current;
      for (const frameId of activeClip.frameIds) withoutClipFrames = removeFrame(withoutClipFrames, frameId).after;
      const patch = createDocumentPatch(current, withoutClipFrames, `Delete ${activeClip.name}`);
      const nextDocument = sessionId ? patch.after : historyRef.current.apply(current, patch);
      replaceDocument(nextDocument, true, (draft) => {
        draft.clips = draft.clips.filter((clip) => clip.id !== activeClip.id);
        draft.active = {
          clipId: fallback.id,
          frameId: fallback.frameIds[0]!,
          layerId: activeLayerId
        };
      });
      if (sessionId) session.sendPatch(patch, webCommandActorRef.current);
      setActiveFrameId(fallback.frameIds[0]!);
      setPlaying(false);
      setNotice(`Deleted ${activeClip.name}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The clip could not be deleted."); }
  };
  const reorderActiveClipFrame = (frameId: string, toIndex: number) => {
    const targetFrameId = activeClip.frameIds[toIndex];
    if (!targetFrameId) return;
    const globalIndex = documentRef.current.frames.findIndex((frame) => frame.id === targetFrameId);
    if (globalIndex >= 0) commit((document) => reorderFrame(document, frameId, globalIndex));
  };
  const completeWebCommandRef = useRef(session.completeWebCommand);
  completeWebCommandRef.current = session.completeWebCommand;
  const executeWebCommandRef = useRef<(command: WebControlCommand) => Promise<unknown>>(async () => null);
  executeWebCommandRef.current = async (command) => {
    if (command.type === "get_context") {
      const recentProjects = await listRecentProjects();
      return {
        connection: { status: session.status, host: session.host, clients: session.clients },
        project: {
          id: project.id,
          name: project.name,
          revision: project.revision,
          clips: project.clips.map((clip) => ({ id: clip.id, name: clip.name, frameIds: [...clip.frameIds] })),
          recentProjects
        },
        sources: sources.map((source) => ({ id: source.id, name: source.name, mimeType: source.mimeType })),
        active: {
          sourceId: activeSource?.id,
          clipId: activeClip.id,
          frameId: displayFrameId,
          layerId: displayLayerId,
          colorIndex
        },
        view: {
          inspectorTab,
          inspectorOpen,
          projectScopeOpen,
          tool,
          editMap,
          normalPreview,
          normalValue,
          showGrid,
          showLightMarker,
          compareMode,
          canvasBackground,
          zoom
        },
        playback: { playing, onionSkin },
        conversion: {
          settings: structuredClone(draftSettings),
          settingsChanged,
          presetCount: presets.length,
          previewing: isPreviewing,
          importing: isImporting
        },
        capabilities: {
          view: ["set_view", "set_active", "set_playback", "set_onion_skin"],
          conversion: ["set_conversion", "save_conversion_preset", "load_conversion_preset"],
          project: ["new_project", "save_project_as", "open_recent_project", "delete_recent_project"],
          files: ["replace-canvas", "add-frames", "add-source", "replace-source", "sprite-sheet", "open-project"],
          export: ["png", "normal", "lit", "gif", "json"]
        }
      };
    }
    if (command.type === "set_view") {
      if (command.inspectorTab) {
        setInspectorTab(command.inspectorTab);
        setKeyboardTarget(command.inspectorTab === "frames" ? "frames" : "canvas");
      }
      if (command.inspectorOpen !== undefined) setInspectorOpen(command.inspectorOpen);
      if (command.projectScopeOpen !== undefined) setProjectScopeOpen(command.projectScopeOpen);
      if (command.tool) setTool(command.tool);
      if (command.editMap) {
        setEditMap(command.editMap);
        if (command.editMap === "normal") setCompareMode(false);
      }
      if (command.normalPreview) setNormalPreview(command.normalPreview);
      if (command.normalValue !== undefined) setNormalValue(command.normalValue);
      if (command.colorIndex !== undefined) {
        if (!Number.isInteger(command.colorIndex) || command.colorIndex < 0 || command.colorIndex >= pixelDocument.palette.length) {
          throw new Error(`Palette index ${command.colorIndex} is out of range.`);
        }
        setColorIndex(command.colorIndex);
      }
      if (command.showGrid !== undefined) setShowGrid(command.showGrid);
      if (command.showLightMarker !== undefined) setShowLightMarker(command.showLightMarker);
      if (command.compareMode !== undefined) {
        if (command.compareMode && (!activeOriginalFrame?.sourceUrl || (command.editMap ?? editMap) === "normal")) {
          throw new Error("Original comparison is unavailable for the active frame or Normal map view.");
        }
        setCompareMode(command.compareMode);
      }
      if (command.canvasBackground !== undefined) {
        if (!/^#[0-9a-f]{6}$/i.test(command.canvasBackground)) throw new Error("Canvas background must be #RRGGBB.");
        setCanvasBackground(command.canvasBackground.toLowerCase());
      }
      if (command.zoom !== undefined) {
        if (!Number.isFinite(command.zoom) || command.zoom < 1 || command.zoom > 48) throw new Error("Zoom must be from 1 to 48.");
        setZoom(command.zoom);
      }
      if (command.fit === "canvas") setFitRequest((current) => current + 1);
      if (command.fit === "selection") setSelectionFitRequest((current) => current + 1);
      return { applied: command.type };
    }
    if (command.type === "set_active") {
      if (command.sourceId) {
        if (!sourcesRef.current.some((source) => source.id === command.sourceId)) {
          throw new Error(`Source ${command.sourceId} does not exist.`);
        }
        selectSource(command.sourceId);
      }
      const currentProject = projectRef.current;
      const requestedFrame = command.frameId;
      const clip = command.clipId
        ? currentProject.clips.find((candidate) => candidate.id === command.clipId)
        : requestedFrame
          ? currentProject.clips.find((candidate) => candidate.frameIds.includes(requestedFrame))
          : currentProject.clips.find((candidate) => candidate.id === activeClip.id);
      if (!clip) throw new Error("The requested Clip or Frame does not exist.");
      const frameId = requestedFrame ?? (clip.frameIds.includes(displayFrameId) ? displayFrameId : clip.frameIds[0]!);
      if (!clip.frameIds.includes(frameId)) throw new Error(`Frame ${frameId} is not in Clip ${clip.id}.`);
      const layerId = command.layerId ?? displayLayerId;
      if (!pixelDocument.layers.some((layer) => layer.id === layerId)) throw new Error(`Layer ${layerId} does not exist.`);
      commitProjectState((draft) => { draft.active = { clipId: clip.id, frameId, layerId }; });
      setActiveFrameId(frameId);
      setActiveLayerId(layerId);
      setKeyboardTarget(command.layerId ? "layers" : command.frameId || command.clipId ? "frames" : "canvas");
      setPlaying(false);
      return { active: { sourceId: command.sourceId ?? activeSource?.id, clipId: clip.id, frameId, layerId } };
    }
    if (command.type === "set_playback") {
      if (command.playing && activeClip.frameIds.length < 2) throw new Error("Playback requires at least two Frames in the active Clip.");
      setPlaying(command.playing);
      return { playing: command.playing };
    }
    if (command.type === "set_onion_skin") {
      const opacity = command.opacity ?? onionSkin.opacity;
      if (!Number.isFinite(opacity) || opacity < 0.1 || opacity > 0.8) throw new Error("Onion skin opacity must be from 0.1 to 0.8.");
      const next = {
        previous: command.previous === undefined ? onionSkin.previous : command.previous ? 1 : 0,
        next: command.next === undefined ? onionSkin.next : command.next ? 1 : 0,
        opacity
      };
      setOnionSkin(next);
      setOnionSettingsOpen(true);
      return next;
    }
    if (command.type === "set_conversion") {
      const next = { ...draftSettingsRef.current, ...command.settings };
      if (!Number.isInteger(next.canvasWidth) || !Number.isInteger(next.canvasHeight) || next.canvasWidth < 1 || next.canvasHeight < 1 || next.canvasWidth > 4096 || next.canvasHeight > 4096) {
        throw new Error("Conversion canvas dimensions must be integers from 1 to 4096.");
      }
      if (!Number.isInteger(next.colorCount) || next.colorCount < 1 || next.colorCount > 256) throw new Error("Conversion color count must be from 1 to 256.");
      if (next.contentScale < 0.25 || next.contentScale > 1) throw new Error("Content scale must be from 0.25 to 1.");
      pendingConversionActorRef.current = "ai";
      updateDraftSettings(() => structuredClone(next));
      setCustomCanvas(!(next.canvasWidth === next.canvasHeight && standardCanvasSizes.includes(next.canvasWidth)));
      setInspectorTab("convert");
      return { settings: next };
    }
    if (command.type === "save_conversion_preset") {
      savePreset();
      return { presetCount: Math.min(8, presets.length + 1) };
    }
    if (command.type === "load_conversion_preset") {
      if (!presets[command.index]) throw new Error(`Conversion preset ${command.index} does not exist.`);
      pendingConversionActorRef.current = "ai";
      loadPreset(command.index);
      return { index: command.index, settings: presets[command.index] };
    }
    if (command.type === "new_project") {
      await createNewProject(command.name?.trim() || "Untitled Project");
      return { projectId: projectRef.current.id, name: projectRef.current.name };
    }
    if (command.type === "save_project_as") {
      const name = command.name.trim();
      if (!name) throw new Error("A Project name is required.");
      await saveProjectAs(name);
      return { projectId: projectRef.current.id, name: projectRef.current.name };
    }
    if (command.type === "open_recent_project") {
      await openRecentProject(command.projectId);
      return { projectId: projectRef.current.id, name: projectRef.current.name };
    }
    if (command.type === "delete_recent_project") {
      if (command.projectId === projectRef.current.id) throw new Error("The open Project cannot be removed from Recent. Open or create another Project first.");
      await deleteRecentProject(command.projectId);
      return { deletedProjectId: command.projectId };
    }
    if (command.type === "remove_source") {
      if (!sourcesRef.current.some((source) => source.id === command.sourceId)) throw new Error(`Source ${command.sourceId} does not exist.`);
      removeSource(command.sourceId);
      return { removedSourceId: command.sourceId };
    }
    if (command.type === "import_files") {
      const files = command.files.map(webImportFileToFile);
      if (command.purpose === "replace-canvas") await performImport(files);
      else if (command.purpose === "add-frames") await importFramesIntoCurrent(files);
      else if (command.purpose === "add-source") await attachSources(files, false);
      else if (command.purpose === "replace-source") await attachSources(files, true);
      else if (command.purpose === "open-project") {
        if (files.length !== 1) throw new Error("Open Project requires exactly one .pixel-project.json file.");
        await openProjectFile(files[0]!);
      } else {
        if (files.length !== 1) throw new Error("Sprite Sheet import requires exactly one image.");
        if (!command.columns || !command.rows) throw new Error("Sprite Sheet columns and rows are required.");
        await importSpriteSheet(files[0]!, command.columns, command.rows);
      }
      return { purpose: command.purpose, fileCount: files.length, names: files.map((file) => file.name) };
    }
    if (command.type === "export") {
      const scale = command.scale ?? 1;
      if (command.format === "json") {
        if (command.scope !== "project") throw new Error("The web Export UI exports JSON at Project scope.");
        downloadProject(projectRef.current);
      } else if (command.scope === "frame") {
        if (command.format === "gif") throw new Error("GIF export requires Clip or Project scope.");
        if (command.format === "normal") await downloadNormalPng(pixelDocument, { frameId: displayFrameId, scale, name: `${project.name}-normal.png` });
        else if (command.format === "lit") await downloadLitPng(pixelDocument, resolveFrameLighting(pixelDocument, activeClip.frameIds, displayFrameId), { frameId: displayFrameId, scale, name: `${project.name}-lit.png` });
        else await downloadPng(pixelDocument, { frameId: displayFrameId, scale, name: `${project.name}.png` });
      } else {
        const frameIds = command.scope === "clip" ? activeClip.frameIds : pixelDocument.frames.map((frame) => frame.id);
        const name = command.scope === "clip" ? `${project.name}-${activeClip.name}` : project.name;
        if (command.format === "gif") downloadAnimationGif(pixelDocument, scale, frameIds, name);
        else if (command.format === "normal") await downloadNormalSpriteSheet(pixelDocument, scale, frameIds, name);
        else if (command.format === "lit") await downloadLitSpriteSheet(pixelDocument, scale, frameIds, name, command.scope === "clip" ? [activeClip.frameIds] : project.clips.map((clip) => clip.frameIds));
        else await downloadSpriteSheet(pixelDocument, scale, frameIds, name);
      }
      return { format: command.format, scope: command.scope, scale, downloadTriggered: true };
    }
    const exhaustive: never = command;
    throw new Error(`Unsupported browser command: ${JSON.stringify(exhaustive)}`);
  };

  useEffect(() => {
    const envelope = session.webCommands[0];
    if (!envelope) return;
    let cancelled = false;
    webCommandActorRef.current = "ai";
    void executeWebCommandRef.current(envelope.command).then((result) => {
      if (!cancelled) completeWebCommandRef.current(envelope.id, { ok: true, result });
    }).catch((error) => {
      if (!cancelled) completeWebCommandRef.current(envelope.id, {
        ok: false,
        error: { message: error instanceof Error ? error.message : "The browser action failed." }
      });
    }).finally(() => {
      webCommandActorRef.current = "user";
    });
    return () => { cancelled = true; };
  }, [session.webCommands]);

  const renderSources = () => (
    <section className="project-scope-panel" aria-labelledby="project-sources-title">
      <header className="project-scope-header">
        <button type="button" className="project-scope-toggle" aria-expanded={projectScopeOpen} aria-controls="project-scope-body" onClick={() => setProjectScopeOpen((current) => !current)}>
          {projectScopeOpen ? <TbChevronDown /> : <TbChevronRight />}
          <span><b id="project-sources-title">Sources</b><small>{project.sources.length === 0 ? "No retained source" : `${project.sources.length} retained source${project.sources.length === 1 ? "" : "s"}`}</small></span>
        </button>
      </header>
      {projectScopeOpen && <div className="project-scope-body" id="project-scope-body">
      <section className="source-shelf" aria-labelledby="source-list-title">
        <header><span><TbRefresh /><h2 id="source-list-title">Retained originals</h2></span><i aria-label={`${project.sources.length} source${project.sources.length === 1 ? "" : "s"}`}>{project.sources.length}</i></header>
      <div className="source-browser">
        {project.sources.length > 1 && <div className="source-picker-row">
          <SelectControl
            ariaLabel="Project source"
            value={activeSource?.id ?? project.sources[0]!.id}
            options={project.sources.map((source) => ({ value: source.id, label: source.name }))}
            onValueChange={selectSource}
          />
        </div>}
        {activeSource ? <div className="source-controls">
          <div className="source-preview" title={activeSource.name}>
            {sourceThumbnailUrl ? <img src={sourceThumbnailUrl} alt={`${activeSource.name} source`} /> : <TbDeviceFloppy aria-label={`${activeSource.name} Pixel document`} />}
          </div>
          <span className="source-name"><b>{activeSource.name}</b><small>Original retained</small></span>
          <Button size="icon" variant="ghost" className="source-delete" aria-label={`Remove ${activeSource.name}`} title={`Remove ${activeSource.name}`} onClick={() => setDeleteTarget({ sourceId: activeSource.id })}><TbX /></Button>
        </div> : <div className="source-note"><TbPhotoOff /><span><b>No source attached</b><small>The canvas remains editable. Add a source only for comparison or reconversion.</small></span></div>}
        {activeSource && deleteTarget?.sourceId === activeSource.id && <div className="delete-confirm" role="alert">
          <span><b>Remove {activeSource.name}?</b><small>The retained original will be removed. The canvas and all edits remain.</small></span>
          <div><Button size="sm" variant="ghost" onClick={() => setDeleteTarget(undefined)}>Cancel</Button><Button size="sm" className="delete-confirm-button" onClick={confirmDelete}>Remove</Button></div>
        </div>}
      </div>
      </section>
      </div>}
    </section>
  );

  const renderInspector = () => (
    <div className="inspector-shell">
      <div className="inspector-source-panel">{renderSources()}</div>
      <Tabs value={inspectorTab} onValueChange={(value) => {
        setInspectorTab(value as InspectorTab);
        if (value === "frames") setKeyboardTarget("frames");
        else if (value !== "edit") setKeyboardTarget("canvas");
      }} className="inspector-tabs">
        <TabsList aria-label="Inspector" className="w-full">
          <TabsTrigger value="convert">Convert</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="frames">Frames</TabsTrigger>
        </TabsList>

        <TabsContent value="convert">

        <InspectorSection icon={TbAdjustments} title="Normalize">
          <Field label="Canvas"><SelectControl ariaLabel="Canvas preset" value={customCanvas ? "custom" : String(draftSettings.canvasWidth)} options={canvasOptions} onValueChange={(value) => {
            if (value === "custom") setCustomCanvas(true);
            else { const size = +value; setCustomCanvas(false); updateDraftSettings((current) => ({ ...current, canvasWidth: size, canvasHeight: size })); }
          }} /></Field>
          {customCanvas && <div className="dimension-row"><BlurNumberInput ariaLabel="Canvas width" min={1} max={4096} value={draftSettings.canvasWidth} onCommit={(canvasWidth) => updateDraftSettings((current) => ({ ...current, canvasWidth }))} /><b>×</b><BlurNumberInput ariaLabel="Canvas height" min={1} max={4096} value={draftSettings.canvasHeight} onCommit={(canvasHeight) => updateDraftSettings((current) => ({ ...current, canvasHeight }))} /></div>}
          <div className="field-grid">
            <Field label="Colors"><BlurNumberInput ariaLabel="Color count" min={2} max={256} value={draftSettings.colorCount} onCommit={(colorCount) => updateDraftSettings((current) => ({ ...current, colorCount }))} /></Field>
            <Field label="Anchor"><SelectControl ariaLabel="Content alignment" value={draftSettings.alignment} options={alignmentOptions} onValueChange={(value) => updateDraftSettings((current) => ({ ...current, alignment: value as ConvertSettings["alignment"] }))} /></Field>
            <Field label="Background" help="Alpha keeps transparency already in the image. Solid removes a flat background sampled from the top-left corner."><SelectControl ariaLabel="Background mode" value={draftSettings.background} options={backgroundOptions} onValueChange={(value) => updateDraftSettings((current) => ({ ...current, background: value as ConvertSettings["background"] }))} /></Field>
            <Field label="Dither" help="Floyd mixes nearby palette colors into a pixel pattern to preserve gradients. None keeps color areas flat and crisp."><SelectControl ariaLabel="Dithering" value={draftSettings.dithering} options={ditheringOptions} onValueChange={(value) => updateDraftSettings((current) => ({ ...current, dithering: value as ConvertSettings["dithering"] }))} /></Field>
          </div>
          <Field label="Fixed Palette" help="Colors are chosen automatically from the source by default. Add colors to lock them during conversion; transparency is included automatically.">
            <div className="fixed-palette-editor">
              <TooltipProvider delayDuration={220}><div className="palette-swatches fixed-palette-list">
                {draftSettings.palette?.map((color, index) => <div className="palette-swatch-item fixed-palette-swatch" key={`${index}-${color}`}>
                  {isTransparentPaletteColor(color)
                    ? <Tooltip><TooltipTrigger asChild><span className="palette-swatch transparent-color" role="img" tabIndex={0} aria-label={`Fixed palette color ${index + 1}, transparent`} /></TooltipTrigger><TooltipContent>{color.toUpperCase()}</TooltipContent></Tooltip>
                    : <Tooltip><TooltipTrigger asChild><input className="palette-swatch palette-color-input" aria-label={`Fixed palette color ${index + 1}`} type="color" value={colorInputValue(color)} onChange={(event) => updateFixedPaletteColor(index, event.target.value)} /></TooltipTrigger><TooltipContent>{color.toUpperCase()}</TooltipContent></Tooltip>}
                  <Button size="icon" variant="ghost" className="palette-swatch-remove" aria-label={`Remove fixed palette color ${index + 1}`} title="Remove color" onClick={() => removeFixedPaletteColor(index)}><TbX /></Button>
                </div>)}
                <ColorAddPopover
                  triggerLabel="Add fixed palette color"
                  inputLabel="Choose fixed palette color"
                  color={newFixedPaletteColor}
                  onColorChange={setNewFixedPaletteColor}
                  onAdd={() => addFixedPaletteColor(newFixedPaletteColor)}
                  onPickFromCanvas={() => { setColorPickTarget("fixed"); setNotice("Click a canvas pixel to sample its color. Press Esc to cancel."); }}
                />
              </div></TooltipProvider>
              {!!draftSettings.palette?.length && <small>{`${draftSettings.palette.length} fixed color${draftSettings.palette.length === 1 ? "" : "s"} · transparency added automatically`}</small>}
            </div>
          </Field>
        </InspectorSection>

        <InspectorSection icon={TbMaximize} title="Content Frame">
          <div className="frame-preset-actions" aria-label="Content frame presets">
            <button type="button" onClick={() => setFramePreset("tight")}>Tight<small>100%</small></button>
            <button type="button" onClick={() => setFramePreset("safe")}>Safe<small>80%</small></button>
          </div>
          <div className="frame-scale-row">
            <input aria-label="Content frame scale" className="frame-slider" type="range" min="0.25" max="1" step="0.01" value={draftSettings.contentScale} onChange={(event) => setContentScalePercent(event.currentTarget.valueAsNumber * 100)} />
            <label className="frame-value-input">
              <span className="sr-only">Custom</span>
              <BlurNumberInput ariaLabel="Custom content frame scale" min={25} max={100} value={Math.round(draftSettings.contentScale * 100)} onCommit={setContentScalePercent} />
              <b aria-hidden="true">%</b>
            </label>
          </div>
        </InspectorSection>

        <InspectorSection icon={TbDeviceFloppy} title="Presets">
          <Field label="Saved Preset"><SelectControl ariaLabel="Conversion preset" value={null} placeholder="Choose…" options={presets.map((preset, index) => ({ value: String(index), label: `${String(index + 1).padStart(2, "0")} · ${preset.canvasWidth}×${preset.canvasHeight} · ${preset.palette?.length ?? preset.colorCount}C` }))} onValueChange={(value) => loadPreset(+value)} /></Field>
          <Button variant="outline" className="w-full" onClick={savePreset}>Save current preset</Button>
        </InspectorSection>

      </TabsContent>

      <TabsContent value="edit">
        <InspectorSection icon={TbSphere} title="Material Maps">
          <div className="material-map-mode" role="group" aria-label="Material map">
            <button type="button" aria-pressed={editMap === "color"} className={editMap === "color" ? "active" : ""} onClick={() => setEditMap("color")}><TbPalette />Color</button>
            <button type="button" aria-pressed={editMap === "normal"} className={editMap === "normal" ? "active" : ""} onClick={() => setEditMap("normal")}><TbSphere />Normal</button>
          </div>
          {editMap === "normal" && <div className="normal-map-editor">
            <div className="normal-preview-mode" role="group" aria-label="Normal preview">
              <button type="button" aria-pressed={normalPreview === "map"} className={normalPreview === "map" ? "active" : ""} onClick={() => setNormalPreview("map")}><TbSphere />Map</button>
              <button type="button" aria-pressed={normalPreview === "lit"} className={normalPreview === "lit" ? "active" : ""} onClick={() => setNormalPreview("lit")}><TbSun />Lit preview</button>
            </div>
            <Field label="Normal direction">
              <NormalDirectionPicker value={normalValue} onChange={setNormalValue} />
            </Field>
            {normalPreview === "lit" && <>
              <LightingMotionEditor
                document={pixelDocument}
                frameIds={activeClip.frameIds}
                activeFrameId={displayFrameId}
                enabled={lightingMotionEnabled}
                keyframeCount={lightingKeyframeCount}
                onEnabledChange={setLightingMotionEnabled}
                onSelectFrame={(frameId) => { setActiveFrameId(frameId); setPlaying(false); setKeyboardTarget("canvas"); }}
                onToggleKeyframe={toggleLightingKeyframe}
                onInterpolationChange={changeLightingInterpolation}
              />
              <Field label="Shading">
                <SelectControl
                  ariaLabel="Lighting shading"
                  value={light.shading ?? DEFAULT_FRAME_LIGHTING.shading}
                  options={lightingShadingOptions}
                  onValueChange={(value) => {
                    const lighting = { ...lightRef.current, shading: value as NonNullable<FrameLighting["shading"]> };
                    previewLighting(lighting);
                    commitLighting(lighting);
                  }}
                />
              </Field>
              {(light.shading ?? DEFAULT_FRAME_LIGHTING.shading) === "toon-palette" && <Field label="Palette ramp" help="Splits each artwork color into 3–6 discrete lighting colors. Normal directions then choose a cool shadow, the original base color, or a warm highlight instead of creating a smooth gradient.">
                <SelectControl
                  ariaLabel="Toon palette ramp steps"
                  value={String(light.toonSteps ?? DEFAULT_FRAME_LIGHTING.toonSteps)}
                  options={toonStepOptions}
                  onValueChange={(value) => {
                    const lighting = { ...lightRef.current, toonSteps: Number(value) };
                    previewLighting(lighting);
                    commitLighting(lighting);
                  }}
                />
              </Field>}
              <Field label="Light strength">
                <div className="normal-slider-control"><input aria-label="Light strength" type="range" min="0" max="1.5" step="0.05" value={light.intensity} onChange={(event) => previewLighting({ intensity: event.currentTarget.valueAsNumber })} onPointerUp={() => commitLighting()} onKeyUp={() => commitLighting()} /><output>{Math.round(light.intensity * 100)}%</output></div>
              </Field>
              <Field label="Ambient light">
                <div className="normal-slider-control"><input aria-label="Ambient light" type="range" min="0" max="1" step="0.05" value={light.ambient} onChange={(event) => previewLighting({ ambient: event.currentTarget.valueAsNumber })} onPointerUp={() => commitLighting()} onKeyUp={() => commitLighting()} /><output>{Math.round(light.ambient * 100)}%</output></div>
              </Field>
            </>}
            <Button variant="outline" className="w-full" onClick={() => commit((document) => resetNormalFrame(document, displayLayerId, displayFrameId))}>Reset normal map</Button>
          </div>}
        </InspectorSection>

        {editMap === "color" && <InspectorSection icon={TbPalette} title="Palette">
          <TooltipProvider delayDuration={220}><div className="palette-swatches edit-palette-list">
            {pixelDocument.palette.map((color, index) => <Tooltip key={`${color}-${index}`}><TooltipTrigger asChild><button aria-label={`Palette ${index}: ${color}`} aria-pressed={colorIndex === index} className={colorIndex === index ? "palette-swatch edit-palette-swatch active" : "palette-swatch edit-palette-swatch"} style={{ "--swatch": color } as CSSProperties} onClick={() => setColorIndex(index)}><i /><span>{index}</span></button></TooltipTrigger><TooltipContent>{color.toUpperCase()}</TooltipContent></Tooltip>)}
            <ColorAddPopover
              triggerLabel="Add palette color"
              inputLabel="New palette color"
              color={newColor}
              onColorChange={setNewColor}
              onAdd={addNewColor}
              onPickFromCanvas={() => { setColorPickTarget("edit"); setNotice("Click a canvas pixel to select or sample its palette color. Press Esc to cancel."); }}
            />
          </div></TooltipProvider>
          <div className="palette-context-actions" aria-label={`Palette color ${colorIndex} actions`}>
            <div className="palette-color-summary"><span className="palette-color-usage"><b>Color {colorIndex}</b><small>{currentColorUsage.toLocaleString()} px used</small></span><Button size="sm" variant="ghost" className="palette-usage-toggle" aria-label={`Select pixels using color ${colorIndex}`} disabled={currentColorUsage === 0} onClick={selectPixelsUsingColor}><TbCurrentLocation />Select pixels</Button></div>
            <PaletteTargetPopover label="Replace with" palette={pixelDocument.palette} selectedIndex={colorIndex} onSelect={(targetIndex) => commit((document) => replaceColor(document, activeLayerId, activeFrameId, colorIndex, targetIndex, document.selection))} />
            <Button size="sm" variant="ghost" disabled={colorIndex === pixelDocument.transparentColorIndex || selectedColorUsage > 0} title={selectedColorUsage > 0 ? `${selectedColorUsage.toLocaleString()} px used across the document. Replace them first.` : "0 px used across the document."} onClick={() => commit((document) => removePaletteColor(document, colorIndex))}><TbTrash />Delete color</Button>
          </div>
        </InspectorSection>}

        <InspectorSection
          icon={TbStack}
          title="Layers"
          action={<Button size="icon" variant="ghost" className="inspector-section-action" aria-label="Add layer" title="Add layer" onClick={() => commit((document) => addLayer(document, `Layer ${document.layers.length + 1}`))}><TbPlus /></Button>}
        >
          <LayersList
            layers={pixelDocument.layers}
            activeLayerId={activeLayerId}
            keyboardTarget={keyboardTarget === "layers"}
            onSelect={(layerId) => { setActiveLayerId(layerId); setKeyboardTarget("layers"); }}
            onVisibility={(layerId, visible) => commit((document) => setLayerVisibility(document, layerId, visible))}
            onReorder={(layerId, toIndex) => commit((document) => reorderLayer(document, layerId, toIndex))}
            onRename={(layerId, name) => commit((document) => renameLayer(document, layerId, name))}
          />
        </InspectorSection>

      </TabsContent>

      <TabsContent value="frames" className="frames-workspace">
        <ResizablePanelGroup
          id="clips-frames-layout"
          orientation="vertical"
          className="frames-resizable"
          defaultLayout={framesPanelLayout.defaultLayout}
          onLayoutChanged={framesPanelLayout.onLayoutChanged}
        >
          <ResizablePanel id="clips-panel" defaultSize="38%" minSize="18%">
            <div className="frames-resizable-pane clips-pane">
              <InspectorSection
                icon={TbPlayerPlay}
                title="Clips"
                count={project.clips.length}
                countLabel="clip"
                action={<Button size="icon" variant="ghost" className="inspector-section-action" aria-label="Add clip" title="Add clip" onClick={addClip}><TbPlus /></Button>}
              >
                <ClipBrowser clips={project.clips} activeClipId={activeClip.id} onSelect={selectClip} onRename={renameActiveClip} onDelete={deleteActiveClip} />
              </InspectorSection>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="frames-resize-handle" aria-label="Resize clips and frames" />

          <ResizablePanel id="frames-panel" defaultSize="62%" minSize="28%">
            <div className="frames-resizable-pane frames-pane">
              <section className="inspector-section clip-frames-section" aria-labelledby="active-clip-frames-title">
          <header>
            <TbChevronRight />
            <h2 id="active-clip-frames-title">Frames</h2>
            <span className="clip-frames-owner"><span>in</span><b title={activeClip.name}>{activeClip.name}</b></span>
            <span className="inspector-section-count" aria-label={`${activeClip.frameIds.length} frame${activeClip.frameIds.length === 1 ? "" : "s"}`}>{activeClip.frameIds.length}</span>
                <div className="inspector-section-actions">
                  <Button size="icon" variant="ghost" className="inspector-section-action" aria-label={playing ? "Stop" : "Play"} title={playing ? "Stop playback" : "Play clip"} disabled={activeClip.frameIds.length < 2} onClick={() => setPlaying((current) => !current)}>{playing ? <TbPlayerStop /> : <TbPlayerPlay />}</Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`inspector-section-action onion-settings-trigger${onionSkin.previous > 0 || onionSkin.next > 0 ? " enabled" : ""}`}
                    aria-label="Onion skin settings"
                    aria-expanded={onionSettingsOpen && activeClip.frameIds.length > 1}
                    aria-pressed={onionSettingsOpen && activeClip.frameIds.length > 1}
                    title="Onion skin settings"
                    disabled={activeClip.frameIds.length < 2}
                    onClick={() => setOnionSettingsOpen((current) => !current)}
                  ><TbLayersIntersect /></Button>
                  <Popover open={frameAddOpen} onOpenChange={setFrameAddOpen}>
                    <PopoverTrigger className="inspector-section-action frame-add-trigger" aria-label="Add frame" title="Add frame"><TbPlus /></PopoverTrigger>
                    <PopoverContent className="frame-add-popover" side="left" align="start" sideOffset={8}>
                      <button type="button" onClick={() => { addNewFrame(); setFrameAddOpen(false); }}><TbFilePlus /><span><b>Blank frame</b><small>Add one empty frame</small></span></button>
                      <button type="button" disabled={isImporting} onClick={() => { setFrameAddOpen(false); frameInputRef.current?.click(); }}><TbFileImport /><span><b>From images</b><small>Import one or more frames</small></span></button>
                    </PopoverContent>
                  </Popover>
                  <input ref={frameInputRef} aria-label="Import frame images" hidden type="file" multiple accept="image/png,image/webp,image/jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    void importFramesIntoCurrent([...event.target.files ?? []]);
                    event.currentTarget.value = "";
                  }} />
                </div>
          </header>
          <div className="inspector-section-body">
              {onionSettingsOpen && activeClip.frameIds.length > 1 && <section className="onion-skin-panel" aria-labelledby="onion-skin-title">
                <header>
                  <span><TbLayersIntersect /><h4 id="onion-skin-title">Onion Skin</h4></span>
                  <small>{`${onionSkin.previous > 0 ? "Previous" : ""}${onionSkin.previous > 0 && onionSkin.next > 0 ? " + " : ""}${onionSkin.next > 0 ? "Next" : ""}${onionSkin.previous === 0 && onionSkin.next === 0 ? "Off" : ` · ${Math.round(onionSkin.opacity * 100)}%`}`}</small>
                </header>
                <div className="onion-frame-toggles">
                  <button type="button" className="onion-frame-toggle" role="switch" aria-label="Show previous frame" aria-checked={onionSkin.previous > 0} onClick={() => setOnionSkin((current) => ({ ...current, previous: current.previous > 0 ? 0 : 1 }))}>
                    <span>Previous</span><i aria-hidden="true" />
                  </button>
                  <button type="button" className="onion-frame-toggle" role="switch" aria-label="Show next frame" aria-checked={onionSkin.next > 0} onClick={() => setOnionSkin((current) => ({ ...current, next: current.next > 0 ? 0 : 1 }))}>
                    <span>Next</span><i aria-hidden="true" />
                  </button>
                </div>
                <div className="onion-opacity-row">
                  <span>Opacity</span>
                  <div className="onion-opacity-control">
                    <input aria-label="Onion skin opacity" type="range" min="0.1" max="0.8" step="0.05" value={onionSkin.opacity} onChange={(event) => setOnionSkin((current) => ({ ...current, opacity: event.currentTarget.valueAsNumber }))} />
                    <output>{Math.round(onionSkin.opacity * 100)}%</output>
                  </div>
                </div>
              </section>}
              <FramesList
                document={pixelDocument}
                frameIds={activeClip.frameIds}
                activeFrameId={activeFrameId}
                keyboardTarget={keyboardTarget === "frames"}
                onSelect={(frameId) => { setActiveFrameId(frameId); setKeyboardTarget("frames"); }}
                onReorder={reorderActiveClipFrame}
                onDuration={(frameId, durationMs) => commit((document) => setFrameDuration(document, frameId, durationMs))}
              />
          </div>
              </section>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </TabsContent>

      </Tabs>
    </div>
  );

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); requestImport([...event.dataTransfer.files]); }}>
      <header className="topbar">
        <div className="brand-block" role="img" aria-label="Editable Pixel">
          <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
            <path className="brand-mark-base" d="M2 2h24v4H2zM2 7h4v4H2zM2 12h19v4H2zM2 17h4v4H2zM2 22h24v4H2z" />
            <path className="brand-mark-active" d="M22 12h4v4h-4z" />
          </svg>
        </div>
        <nav className="project-context" aria-label="Project location">
          <ProjectMenu
            projectId={project.id}
            projectName={project.name}
            onRename={renameProject}
            onNew={createNewProject}
            onSaveAs={saveProjectAs}
            onOpenFile={openProjectFile}
            onOpenRecent={openRecentProject}
          />
          {showClipInProjectContext && <>
            <span aria-hidden="true">/</span>
            <span title={activeClip.name}>{activeClip.name}</span>
          </>}
        </nav>
        <div className="header-actions">
          <Button size="icon" variant="ghost" aria-label="Import" title="Import image or Pixel JSON" onClick={() => fileInputRef.current?.click()} disabled={isImporting}><TbFileImport /></Button>
          <ExportPopover project={project} clip={activeClip} frameId={displayFrameId} />
          <Button variant="ghost" className="mobile-inspector-trigger" aria-label="Open inspector" onClick={() => setInspectorOpen(true)}><TbAdjustments /></Button>
          <input ref={fileInputRef} aria-label="Import files" hidden type="file" multiple accept="image/png,image/webp,image/jpeg,.pixel.json,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => {
            requestImport([...event.target.files ?? []]);
            event.currentTarget.value = "";
          }} />
        </div>
      </header>

      <section className="workbench">
        <section className="canvas-column">
          <div className="canvas-toolbar"><span className="toolbar-frame" title={displayFrameLabel}>{displayFrameLabel}</span><span className="toolbar-separator">/</span><span className="toolbar-layer" title={displayLayer.name}>{displayLayer.name}</span>{editMap === "normal" && <><span className="toolbar-separator">/</span><span className="toolbar-map">Normal · {normalPreview === "lit" ? "Lit" : "Map"}</span></>}<div className="toolbar-spacer" /><div className="history-control"><IconButton label="Undo" icon={TbArrowBackUp} onClick={undo} disabled={!sessionId && !historyRef.current.canUndo} /><IconButton label="Redo" icon={TbArrowForwardUp} onClick={redo} disabled={!sessionId && !historyRef.current.canRedo} /></div><div className="view-control"><IconButton label="Toggle grid" icon={TbGridDots} active={showGrid} aria-pressed={showGrid} onClick={() => setShowGrid((current) => !current)} />{editMap === "normal" && normalPreview === "lit" && <IconButton label={showLightMarker ? "Hide light marker" : "Show light marker"} icon={showLightMarker ? TbBulb : TbBulbOff} active={showLightMarker} aria-pressed={showLightMarker} onClick={() => setShowLightMarker((current) => !current)} />}<IconButton label="Compare original" icon={compareMode ? TbColumns2Filled : TbColumns2} className={compareMode ? "view-active" : ""} aria-pressed={compareMode} title={activeOriginalFrame?.sourceUrl ? "Compare original" : "Original unavailable"} onClick={() => setCompareMode((current) => activeOriginalFrame?.sourceUrl && editMap === "color" ? !current : false)} disabled={!activeOriginalFrame?.sourceUrl || editMap === "normal"} /></div><div className="zoom-control"><IconButton label="Zoom out" icon={TbZoomOut} onClick={() => setZoom((current) => Math.max(1, current - 1))} /><span>{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" icon={TbZoomIn} onClick={() => setZoom((current) => Math.min(48, current + 1))} /></div><Button size="sm" variant="ghost" onClick={() => setFitRequest((current) => current + 1)}>Fit</Button></div>

          <div className="canvas-surface" aria-busy={isPreviewing}>
            <PixelCanvas document={displayDocument} layerId={displayLayerId} frameId={displayFrameId} tool={tool} colorIndex={colorIndex} editMap={editMap} normalValue={normalValue} normalPreview={normalPreview} light={light} showLightMarker={showLightMarker} zoom={zoom} showGrid={showGrid} onionSkin={resolveCanvasOnionSkin(onionSkin, activeClip.frameIds, playing)} canvasBackground={canvasBackground} referenceImageUrl={activeOriginalFrame?.sourceUrl} compareMode={compareMode} colorPickMode={editMap === "color" && Boolean(colorPickTarget)} keyboardTarget={keyboardTarget === "canvas"} fitRequest={fitRequest} selectionFitRequest={selectionFitRequest} onFitZoom={setZoom} onZoom={setZoom} onActivate={() => setKeyboardTarget("canvas")} onEdit={commit} onSelection={setSelection} onLightPosition={(x, y) => previewLighting({ x, y })} onLightCommit={(x, y) => commitLighting({ ...lightRef.current, x, y })} onPickColor={(color) => {
              const normalized = normalizePaletteColor(color);
              const existingIndex = pixelDocument.palette.findIndex((candidate) => normalizePaletteColor(candidate) === normalized);
              if (colorPickTarget === "edit") {
                if (existingIndex >= 0) {
                  setColorIndex(existingIndex);
                  setNotice(`Selected palette color ${existingIndex}.`);
                } else {
                  setNewColor(colorInputValue(color));
                  setNotice(`Sampled ${colorInputValue(color).toUpperCase()}. Open Add color to add it to the palette.`);
                }
              } else if (colorPickTarget === "fixed") {
                if (isTransparentPaletteColor(color)) setNotice("Transparency is already added automatically to the fixed palette.");
                else {
                  setNewFixedPaletteColor(colorInputValue(color));
                  setNotice(`Sampled ${colorInputValue(color).toUpperCase()}. Open Add color to add it to the fixed palette.`);
                }
              }
              setColorPickTarget(undefined);
            }} />
            <CanvasBackgroundControl document={displayDocument} frameId={displayFrameId} color={canvasBackground} onColor={setCanvasBackground} />
            {editMap === "color" && colorPickTarget && <div className="canvas-color-pick-hint"><TbColorPicker /><span><b>Pick a color</b><small>Click a canvas pixel · Esc to cancel</small></span></div>}
            <SessionStatus sessionId={sessionId} status={session.status} host={session.host} clients={session.clients} revision={project.revision} saveState={projectSaveState} selection={pixelDocument.selection} />
            {editMap === "color" && pixelDocument.selection && <SelectionDock onAction={selectionAction} />}
            <ToolDock tool={tool} shiftPressed={shiftPressed} onTool={setTool} />
            <ShortcutHelp />
          </div>
          <footer className="canvas-footer"><span>{notice}</span><span>{displayDocument.selection ? displayDocument.selection.type === "mask" ? `Editing within selection · ${displayDocument.selection.indices.length.toLocaleString()} pixels · Esc to clear` : `Editing within selection · ${displayDocument.selection.x},${displayDocument.selection.y} / ${displayDocument.selection.width}×${displayDocument.selection.height} · Esc to clear` : "No selection"}</span></footer>
        </section>
        <aside className="inspector desktop-inspector">{renderInspector()}</aside>
      </section>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}><SheetContent className="mobile-inspector"><div className="sheet-header"><SheetTitle>Inspector</SheetTitle><Button size="icon" variant="ghost" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}><TbX /></Button></div>{renderInspector()}</SheetContent></Sheet>

      {pendingImport && <ImportPurposeDialog
        files={pendingImport.imageFiles}
        otherFiles={pendingImport.otherFiles}
        hasSource={Boolean(activeSource)}
        onMove={(index, direction) => setPendingImport((current) => {
          if (!current) return current;
          const nextIndex = index + direction;
          if (nextIndex < 0 || nextIndex >= current.imageFiles.length) return current;
          const imageFiles = [...current.imageFiles];
          const [moved] = imageFiles.splice(index, 1);
          imageFiles.splice(nextIndex, 0, moved!);
          return { ...current, imageFiles };
        })}
        onCancel={() => setPendingImport(undefined)}
        onReplaceCanvas={() => {
          const files = [...pendingImport.otherFiles, ...pendingImport.imageFiles];
          setPendingImport(undefined);
          void performImport(files);
        }}
        onFrames={() => {
          const files = [...pendingImport.imageFiles];
          setPendingImport(undefined);
          void importFramesIntoCurrent(files);
        }}
        onAddSource={() => {
          const files = [...pendingImport.otherFiles, ...pendingImport.imageFiles];
          setPendingImport(undefined);
          void attachSources(files, false);
        }}
        onReplaceSource={() => {
          const files = [...pendingImport.otherFiles, ...pendingImport.imageFiles];
          setPendingImport(undefined);
          void attachSources(files, true);
        }}
        onSpriteSheet={(columns, rows) => {
          const file = pendingImport.imageFiles[0];
          if (!file) return;
          setPendingImport(undefined);
          void importSpriteSheet(file, columns, rows);
        }}
      />}

      {session.pendingPatch && <section className="patch-drawer"><div><small>AGENT PATCH / REVIEW REQUIRED</small><h2>{session.pendingPatch.patch.reason}</h2><p>{session.pendingPatch.patch.kind !== "document" ? `${session.pendingPatch.patch.changes.length} pixels inside ${session.pendingPatch.patch.bounds.width}×${session.pendingPatch.patch.bounds.height}${session.pendingPatch.patch.kind === "palette-pixels" ? ` · +${session.pendingPatch.patch.newColors.length} colors` : ""}` : "Document structure change"}</p></div><figure><figcaption>BEFORE</figcaption><DocumentPreview document={session.pendingPatch.before} /></figure><div className="patch-arrow"><TbChevronRight /></div><figure><figcaption>AFTER</figcaption><DocumentPreview document={session.pendingPatch.after} /></figure><div className="patch-actions"><Button variant="outline" onClick={() => session.decidePatch(session.pendingPatch!.patch.id, "reject")}>REJECT</Button><Button variant="accent" onClick={() => session.decidePatch(session.pendingPatch!.patch.id, "apply")}>APPLY PATCH</Button></div></section>}
    </main>
  );
}

function ImportPurposeDialog({ files, otherFiles, hasSource, onMove, onCancel, onReplaceCanvas, onFrames, onAddSource, onReplaceSource, onSpriteSheet }: {
  files: File[];
  otherFiles: File[];
  hasSource: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onCancel: () => void;
  onReplaceCanvas: () => void;
  onFrames: () => void;
  onAddSource: () => void;
  onReplaceSource: () => void;
  onSpriteSheet: (columns: number, rows: number) => void;
}) {
  const [spriteMode, setSpriteMode] = useState(false);
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(4);
  const total = files.length + otherFiles.length;
  return (
    <div className="import-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <header>
          <span><b id="import-dialog-title">Choose an import purpose</b><small>The file count does not decide where your data belongs.</small></span>
          <Button size="icon" variant="ghost" aria-label="Cancel import" onClick={onCancel}><TbX /></Button>
        </header>
        <ol className="import-frame-list" aria-label="Frame order">
          {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
            <FileThumbnail file={file} />
            <span><b>{files.length > 1 ? `Frame ${index + 1}` : "Image"}</b><small title={file.name}>{file.name}</small></span>
            {files.length > 1 && <div>
              <Button size="icon" variant="ghost" aria-label={`Move ${file.name} earlier`} disabled={index === 0} onClick={() => onMove(index, -1)}><TbArrowLeft /></Button>
              <Button size="icon" variant="ghost" aria-label={`Move ${file.name} later`} disabled={index === files.length - 1} onClick={() => onMove(index, 1)}><TbArrowRight /></Button>
            </div>}
          </li>)}
          {otherFiles.map((file) => <li key={`${file.name}-${file.lastModified}`}><span className="import-file-icon"><TbJson /></span><span><b>Pixel JSON</b><small title={file.name}>{file.name}</small></span></li>)}
        </ol>
        {spriteMode ? <div className="sprite-sheet-fields">
          <div><Field label="Columns"><BlurNumberInput ariaLabel="Sprite sheet columns" min={1} max={128} value={columns} onCommit={setColumns} /></Field><Field label="Rows"><BlurNumberInput ariaLabel="Sprite sheet rows" min={1} max={128} value={rows} onCommit={setRows} /></Field></div>
          <small>{columns * rows} frames, read left to right and top to bottom.</small>
          <div><Button variant="ghost" onClick={() => setSpriteMode(false)}>Back</Button><Button onClick={() => onSpriteSheet(columns, rows)}>Import {columns * rows} frames</Button></div>
        </div> : <div className="import-purpose-grid">
          <button type="button" onClick={onReplaceCanvas}><TbFilePlus /><span><b>Replace Canvas</b><small>Use this input as the Project canvas</small></span></button>
          <button type="button" disabled={files.length === 0 || otherFiles.length > 0} onClick={onFrames}><TbPlayerPlay /><span><b>Add as Frames</b><small>Add images to the current clip</small></span></button>
          <button type="button" disabled={files.length !== 1 || otherFiles.length > 0} onClick={() => setSpriteMode(true)}><TbGridDots /><span><b>Import Sprite Sheet</b><small>Split one image into ordered frames</small></span></button>
          <button type="button" onClick={onAddSource}><TbPlus /><span><b>Add Source</b><small>Retain for comparison and reconversion</small></span></button>
          <button type="button" disabled={!hasSource || total !== 1} onClick={onReplaceSource}><TbRefresh /><span><b>Replace Source</b><small>Replace the selected retained input</small></span></button>
        </div>}
      </section>
    </div>
  );
}

function FileThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" /> : <span aria-hidden="true" />;
}

function ToolDock({ tool, shiftPressed, onTool }: { tool: Tool; shiftPressed: boolean; onTool: (tool: Tool) => void }) {
  return <TooltipProvider delayDuration={250}><div className="tool-dock" role="toolbar" aria-label="Drawing tools">{toolLabels.map(({ value, key, label, icon: Icon, activeIcon: ActiveIcon }) => {
    const toggleSelection = value === "select" && tool === "select" && shiftPressed;
    return <Tooltip key={value}><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={label} aria-keyshortcuts={key} aria-pressed={tool === value} data-icon-style={tool === value ? "solid" : "line"} data-selection-mode={toggleSelection ? "toggle" : undefined} className={tool === value ? "active" : ""} onClick={() => onTool(value)}>{toggleSelection ? <TbPointerPlus /> : tool === value ? <ActiveIcon /> : <Icon />}</Button></TooltipTrigger><TooltipContent>{toggleSelection ? "Add or remove selection" : label} <kbd>{toggleSelection ? "Shift" : key}</kbd></TooltipContent></Tooltip>;
  })}</div></TooltipProvider>;
}

function SelectionDock({ onAction }: { onAction: (action: SelectionAction) => void }) {
  const groups: Array<Array<{ action: SelectionAction; label: string; icon: IconType }>> = [
    [
      { action: "move-left", label: "Move selection left", icon: TbArrowLeft },
      { action: "move-up", label: "Move selection up", icon: TbArrowUp },
      { action: "move-down", label: "Move selection down", icon: TbArrowDown },
      { action: "move-right", label: "Move selection right", icon: TbArrowRight }
    ],
    [
      { action: "copy", label: "Copy selection", icon: TbCopy },
      { action: "clear", label: "Clear selected pixels", icon: TbTrash }
    ],
    [
      { action: "flip-h", label: "Flip selection horizontally", icon: TbFlipHorizontal },
      { action: "flip-v", label: "Flip selection vertically", icon: TbFlipVertical }
    ]
  ];
  return <TooltipProvider delayDuration={250}><div className="selection-dock" role="toolbar" aria-label="Selection actions">{groups.map((group) => <div className="selection-dock-group" key={group[0]!.action}>{group.map(({ action, label, icon: Icon }) => <Tooltip key={action}><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label={label} onClick={() => onAction(action)}><Icon /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>)}</div>)}</div></TooltipProvider>;
}

function ShortcutHelp() {
  const shortcuts = [
    ["P / E / F / S", "Pen, Eraser, Fill, Select"],
    ["Space + drag", "Pan canvas"],
    ["Z + drag", "Zoom to area"],
    ["⌘/Ctrl + wheel", "Zoom in or out"],
    ["Shift + 1", "Fit canvas"],
    ["Shift + 2", "Fit selection"],
    ["Shift + click", "Add or remove pixels from selection"],
    ["⌘/Ctrl + Z", "Undo"],
    ["⇧⌘/Ctrl + Z", "Redo"],
    ["Canvas · ⌘/Ctrl + C/X/V", "Copy, cut, or paste selected pixels"],
    ["Canvas · Delete / Backspace", "Clear selected pixels"],
    ["Layers · ⌘/Ctrl + C/V", "Copy or paste the active layer"],
    ["Layers · Delete / Backspace", "Delete the active layer"],
    ["Frames · Delete / Backspace", "Delete the active frame"],
    ["Esc", "Deselect"]
  ];
  return (
    <div className="shortcut-help">
      <Popover>
        <PopoverTrigger aria-label="Keyboard shortcuts"><TbQuestionMark /></PopoverTrigger>
        <PopoverContent className="shortcut-popover">
          <h2>Shortcuts</h2>
          <div className="shortcut-list">
            {shortcuts.map(([keys, label]) => <div key={keys}><kbd>{keys}</kbd><span>{label}</span></div>)}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function CanvasBackgroundControl({ document, frameId, color, onColor }: {
  document: PixelDocument;
  frameId: string;
  color: string;
  onColor: (color: string) => void;
}) {
  return (
    <div className="canvas-background-control">
      <Popover>
        <PopoverTrigger className="canvas-background-trigger" aria-label="Canvas background" title="Canvas background">
          <span className="canvas-background-thumbnail"><DocumentPreview document={document} frameId={frameId} /></span>
          <span className="canvas-background-current" style={{ backgroundColor: color }} />
        </PopoverTrigger>
        <PopoverContent className="canvas-background-popover" side="top" align="start" sideOffset={8}>
          <header><b>Canvas background</b><small>Preview only · exports stay transparent</small></header>
          <div className="canvas-background-presets">
            {canvasBackgroundPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`Set canvas background to ${preset.toUpperCase()}`}
                aria-pressed={color.toLowerCase() === preset}
                className={color.toLowerCase() === preset ? "active" : ""}
                style={{ backgroundColor: preset }}
                onClick={() => onColor(preset)}
              />
            ))}
            <label title="Custom canvas background">
              <TbColorPicker />
              <input aria-label="Custom canvas background" type="color" value={color} onChange={(event) => onColor(event.target.value)} />
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SessionStatus({ sessionId, status, host, clients, revision, saveState, selection }: {
  sessionId?: string;
  status: ConnectionStatus;
  host?: "browser" | "codex" | "claude";
  clients: string[];
  revision: number;
  saveState: ProjectSaveState;
  selection?: Selection;
}) {
  const statusLabel = ({
    standalone: "Standalone",
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting",
    conflict: "Conflict"
  } satisfies Record<ConnectionStatus, string>)[status];
  const hostLabel = host ? `${host.charAt(0).toUpperCase()}${host.slice(1)}` : undefined;
  const connectionLabel = sessionId ? `${hostLabel ?? "Session"} ${statusLabel.toLowerCase()}` : statusLabel;
  const selectionLabel = selection
    ? selection.type === "mask"
      ? `${selection.indices.length.toLocaleString()} pixels · ${selection.width}×${selection.height} bounds`
      : `${selection.x},${selection.y} · ${selection.width}×${selection.height}`
    : "No active selection";
  const saveLabel = ({
    saving: "Saving…",
    saved: "Saved",
    reconnecting: "Unsaved changes",
    unsaved: "Unsaved changes",
    failed: "Save failed",
    conflict: "Conflict"
  } satisfies Record<ProjectSaveState["status"], string>)[saveState.status];

  return (
    <div className="session-status">
      <Popover>
        <PopoverTrigger aria-label="Session details" className="session-status-trigger">
          <span className={`status-light status-${status}`} />
          <span><b>{connectionLabel}</b><small>{sessionId ? `Session ${sessionId.slice(0, 8)}` : "Local workspace"}</small></span>
        </PopoverTrigger>
        <PopoverContent className="session-popover" side="bottom" align="center" sideOffset={8}>
          <header className="session-popover-header">
            <span className={`status-light status-${status}`} />
            <span><b>{connectionLabel}</b><small>{sessionId ? `Session ${sessionId.slice(0, 8)}` : "No Codex or Claude session"}</small></span>
            <i className={saveState.status === "saved" ? "saved" : "unsaved"}>{saveLabel}</i>
          </header>
          <dl className="session-meta">
            <div><dt>Host</dt><dd>{hostLabel ?? "None"}</dd></div>
            <div><dt>Clients</dt><dd className="session-clients">{clients.length > 0 ? clientLabels(clients).join(" · ") : "None"}</dd></div>
            <div><dt>Revision</dt><dd>{revision}</dd></div>
          </dl>
          <section className="agent-workflow">
            <h2>Agent workflow</h2>
            <ol>
              <li><i>1</i><span><b>Describe the target</b><small>The agent can use or set the Canvas selection</small></span></li>
              <li><i>2</i><span><b>Ask Codex or Claude</b><small>{selectionLabel}</small></span></li>
              <li><i>3</i><span><b>Continue or undo</b><small>AI and browser edits share the same History</small></span></li>
            </ol>
          </section>
          <p className="agent-safety">Validated agent actions apply immediately. Revision checks prevent stale writes, and Undo restores either user or AI changes.</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function IconButton({ label, icon: Icon, active = false, ...props }: { label: string; icon: IconType; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button size="icon" variant="ghost" aria-label={label} title={label} className={active ? "active" : ""} {...props}><Icon /></Button>;
}

function ProjectMenu({ projectId, projectName, onRename, onNew, onSaveAs, onOpenFile, onOpenRecent }: {
  projectId: string;
  projectName: string;
  onRename: (name: string) => void;
  onNew: (name: string) => Promise<void>;
  onSaveAs: (name: string) => Promise<void>;
  onOpenFile: (file: File) => Promise<void>;
  onOpenRecent: (projectId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(projectName);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState(`${projectName} Copy`);
  const [recent, setRecent] = useState<RecentProjectSummary[]>([]);
  const [deleteRecentId, setDeleteRecentId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    void listRecentProjects()
      .then((projects) => setRecent(projects.filter((project) => project.id !== projectId)))
      .catch(() => setRecent([]));
  }, [open, projectId]);
  useEffect(() => setProjectNameDraft(projectName), [projectName]);
  useEffect(() => {
    if (open) return;
    setSaveAsOpen(false);
    setDeleteRecentId(undefined);
    setSaveAsName(`${projectName} Copy`);
  }, [open, projectName]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project could not be opened.");
    } finally {
      setBusy(false);
    }
  };
  const commitProjectName = () => {
    const nextName = projectNameDraft.trim();
    if (!nextName) return setProjectNameDraft(projectName);
    setProjectNameDraft(nextName);
    onRename(nextName);
  };
  const removeRecentProject = async (project: RecentProjectSummary) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteRecentProject(project.id);
      setRecent((current) => current.filter((candidate) => candidate.id !== project.id));
      setDeleteRecentId(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The local project could not be deleted.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="project-menu-trigger" aria-label="Project menu" title={projectName}>
        <strong>{projectName}</strong><TbChevronDown />
      </PopoverTrigger>
      <PopoverContent className="project-menu-popover" side="bottom" align="start" sideOffset={8}>
        <header><b>Project</b><small>Autosaved locally</small></header>
        <div className="project-name-field">
          <label htmlFor="project-name-input">Project name</label>
          <div className="project-name-control">
            <input id="project-name-input" aria-label="Project name" maxLength={256} value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.currentTarget.value)} onBlur={commitProjectName} onKeyDown={(event) => {
              if (event.key === "Enter") { event.currentTarget.blur(); }
              if (event.key === "Escape") { setProjectNameDraft(projectName); event.currentTarget.blur(); }
            }} />
            <Button size="icon" variant="ghost" aria-label="Save As" title="Save As" disabled={busy} onClick={() => {
              setSaveAsName(`${projectNameDraft.trim() || projectName} Copy`);
              setSaveAsOpen(true);
            }}><VscSaveAs /></Button>
          </div>
        </div>
        <div className="project-file-actions" aria-label="Project file actions">
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => onNew("Untitled Project"))}><TbFilePlus />New</Button>
          <Button variant="ghost" disabled={busy} onClick={() => inputRef.current?.click()}><TbFolderOpen />Open file</Button>
        </div>
        {saveAsOpen && <section className="project-save-as-panel" aria-label="Save As project">
              <header><b>Save as a new project</b><small>The current project stays independent.</small></header>
              <input aria-label="Save As project name" autoFocus value={saveAsName} onChange={(event) => setSaveAsName(event.currentTarget.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && saveAsName.trim()) void run(() => onSaveAs(saveAsName.trim()));
                if (event.key === "Escape") setSaveAsOpen(false);
              }} />
              <div><Button size="sm" variant="ghost" onClick={() => setSaveAsOpen(false)}>Cancel</Button><Button size="sm" disabled={busy || !saveAsName.trim()} onClick={() => void run(() => onSaveAs(saveAsName.trim()))}>Create project</Button></div>
            </section>}
        <input ref={inputRef} aria-label="Open Project file input" hidden type="file" accept=".pixel-project.json,application/json" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void run(() => onOpenFile(file));
        }} />
        <section className="recent-projects" aria-label="Recent projects">
          <span>Recent</span>
          {recent.length === 0
            ? <small>No other recent projects</small>
            : recent.slice(0, 6).map((project) => deleteRecentId === project.id
              ? <div className="recent-project-delete" role="alert" key={project.id}>
                  <span><b>Delete {project.name}?</b><small>This removes its local autosaved project.</small></span>
                  <div><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteRecentId(undefined)}>Cancel</Button><Button size="sm" className="delete-confirm-button" disabled={busy} onClick={() => void removeRecentProject(project)}>Delete</Button></div>
                </div>
              : <div className="recent-project-row" key={project.id}>
                <button type="button" disabled={busy} onClick={() => void run(() => onOpenRecent(project.id))}>
                  <b>{project.name}</b><small>Revision {project.revision} · {new Date(project.updatedAt).toLocaleDateString()}</small>
                </button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${project.name}`} title="Delete local project" disabled={busy} onClick={() => setDeleteRecentId(project.id)}><TbTrash /></Button>
              </div>
            )}
        </section>
        {error && <p role="alert" className="project-menu-error">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

function ExportPopover({ project, clip, frameId }: {
  project: PixelProject;
  clip: PixelProject["clips"][number];
  frameId: string;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"png" | "normal" | "lit" | "gif" | "json">("png");
  const [scope, setScope] = useState<"frame" | "clip" | "project">("frame");
  const [scale, setScale] = useState(1);
  const scales = [1, 2, 4, 8];
  const document = project.document;
  const frameIds = scope === "clip" ? clip.frameIds : document.frames.map((frame) => frame.id);
  const scopeLabels = { frame: "Current Frame", clip: "Current Clip", project: "Entire Project" } as const;
  const exportCurrent = async () => {
    if (format === "json") {
      if (scope === "project") downloadProject(project);
      else downloadDocument(document);
      setOpen(false);
      return;
    }
    if (scope === "frame") {
      if (format === "normal") await downloadNormalPng(document, { frameId, scale, name: `${project.name}-normal.png` });
      else if (format === "lit") {
        await downloadLitPng(
          document,
          resolveFrameLighting(document, clip.frameIds, frameId),
          { frameId, scale, name: `${project.name}-lit.png` }
        );
      } else await downloadPng(document, { frameId, scale, name: `${project.name}.png` });
    } else {
      const targetFrameIds = scope === "clip" ? clip.frameIds : document.frames.map((frame) => frame.id);
      const name = scope === "clip" ? `${project.name}-${clip.name}` : project.name;
      if (format === "gif") downloadAnimationGif(document, scale, targetFrameIds, name);
      else if (format === "normal") await downloadNormalSpriteSheet(document, scale, targetFrameIds, name);
      else if (format === "lit") await downloadLitSpriteSheet(
        document,
        scale,
        targetFrameIds,
        name,
        scope === "clip" ? [clip.frameIds] : project.clips.map((projectClip) => projectClip.frameIds)
      );
      else await downloadSpriteSheet(document, scale, targetFrameIds, name);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="header-export-trigger" aria-label="Export" title="Export"><TbDownload /></PopoverTrigger>
      <PopoverContent className="export-popover" side="bottom" align="end" sideOffset={8}>
        <header><b>Export</b><small>Choose a result format and ownership scope</small></header>
        <section className="export-section">
          <span className="export-label">Format</span>
          <div className="export-format" role="group" aria-label="Export format">
            <button type="button" aria-pressed={format === "png"} className={format === "png" ? "active" : ""} onClick={() => setFormat("png")}><TbFileTypePng />PNG</button>
            <button type="button" aria-pressed={format === "normal"} className={format === "normal" ? "active" : ""} onClick={() => setFormat("normal")}><TbSphere />Normal map</button>
            <button type="button" aria-pressed={format === "lit"} className={format === "lit" ? "active" : ""} onClick={() => setFormat("lit")}><TbSun />Lit PNG</button>
            <button type="button" aria-pressed={format === "gif"} className={format === "gif" ? "active" : ""} onClick={() => { setFormat("gif"); if (scope === "frame") setScope("clip"); }}><TbPlayerPlay />GIF</button>
            <button type="button" aria-pressed={format === "json"} className={format === "json" ? "active" : ""} onClick={() => { setFormat("json"); setScope("project"); }}><TbJson />JSON</button>
          </div>
        </section>
        <section className="export-section">
          <span className="export-label">Scope</span>
          <div className="export-scope" role="group" aria-label="Export scope">
            {(Object.keys(scopeLabels) as Array<keyof typeof scopeLabels>).map((value) => <button type="button" key={value} disabled={(format === "json" && (value === "frame" || value === "clip")) || (format === "gif" && value === "frame")} aria-pressed={scope === value} className={scope === value ? "active" : ""} onClick={() => setScope(value)}>{scopeLabels[value]}</button>)}
          </div>
        </section>
        {format !== "json" && <>
          <section className="export-section">
            <span className="export-label">Scale</span>
            <div className="export-scale" role="group" aria-label="PNG scale">
              {scales.map((value) => <button type="button" key={value} aria-pressed={scale === value} className={scale === value ? "active" : ""} onClick={() => setScale(value)}>{value}×</button>)}
            </div>
            <output className="export-size">{document.canvas.width} × {document.canvas.height}<span>→</span><b>{document.canvas.width * scale * (format === "gif" || scope === "frame" ? 1 : frameIds.length)} × {document.canvas.height * scale}</b></output>
          </section>
        </>}
        <Button className="export-submit" onClick={() => void exportCurrent()}>{format === "json" ? <TbJson /> : format === "normal" ? <TbSphere /> : format === "lit" ? <TbSun /> : format === "gif" ? <TbPlayerPlay /> : <TbFileTypePng />}{format === "json" && scope === "project" ? "Export Project" : `Export ${scopeLabels[scope]} ${format === "json" ? "Pixel JSON" : format === "normal" ? "Normal" : format === "lit" ? "Lit" : format === "gif" ? "GIF" : "PNG"}`}</Button>
      </PopoverContent>
    </Popover>
  );
}

function LayersList({ layers, activeLayerId, keyboardTarget, onSelect, onVisibility, onReorder, onRename }: {
  layers: Layer[];
  activeLayerId: string;
  keyboardTarget: boolean;
  onSelect: (layerId: string) => void;
  onVisibility: (layerId: string, visible: boolean) => void;
  onReorder: (layerId: string, toIndex: number) => void;
  onRename: (layerId: string, name: string) => void;
}) {
  const displayLayers = [...layers].reverse();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const newDisplayIndex = displayLayers.findIndex((layer) => layer.id === over.id);
    if (newDisplayIndex < 0) return;
    onReorder(String(active.id), layers.length - 1 - newDisplayIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => onSelect(String(active.id))}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={displayLayers.map((layer) => layer.id)} strategy={verticalListSortingStrategy}>
        <div className="stack-list">
          {displayLayers.map((layer) => (
            <SortableLayerRow
              key={layer.id}
              layer={layer}
              active={activeLayerId === layer.id}
              keyboardTarget={keyboardTarget && activeLayerId === layer.id}
              canReorder={layers.length > 1}
              onSelect={() => onSelect(layer.id)}
              onVisibility={() => onVisibility(layer.id, !layer.visible)}
              onRename={(name) => onRename(layer.id, name)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ClipBrowser({ clips, activeClipId, onSelect, onRename, onDelete }: {
  clips: PixelProject["clips"];
  activeClipId: string;
  onSelect: (clipId: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0]!;
  const [draftName, setDraftName] = useState(activeClip.name);
  useEffect(() => {
    if (!editing) setDraftName(activeClip.name);
  }, [activeClip.name, editing]);
  const beginRename = (clip: (typeof clips)[number]) => {
    onSelect(clip.id);
    setDraftName(clip.name);
    setEditing(true);
  };
  const commitName = () => {
    const nextName = draftName.trim();
    setEditing(false);
    if (!nextName) return setDraftName(activeClip.name);
    if (nextName !== activeClip.name) onRename(nextName);
  };

  return <div className="clip-browser" role="list" aria-label="Animation clips">
    {clips.map((clip) => {
      const active = clip.id === activeClipId;
      return <div key={clip.id} className={`clip-item${active ? " active" : ""}`}>
        {active && editing
          ? <div className="clip-select clip-select-editing">
              <TbPlayerPlay />
              <span>
                <input
                  className="clip-name-input"
                  aria-label="Clip name"
                  autoFocus
                  maxLength={256}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setDraftName(activeClip.name);
                      setEditing(false);
                    }
                  }}
                />
                <small>{clip.frameIds.length} frame{clip.frameIds.length === 1 ? "" : "s"}</small>
              </span>
            </div>
          : <button type="button" className="clip-select" aria-label={`Select ${clip.name} clip`} aria-pressed={active} title="Double-click to rename" onClick={() => onSelect(clip.id)} onDoubleClick={() => beginRename(clip)}>
              <TbPlayerPlay />
              <span><b>{clip.name}</b><small>{clip.frameIds.length} frame{clip.frameIds.length === 1 ? "" : "s"}</small></span>
            </button>}
        {active && <Button size="icon" variant="ghost" className="clip-item-action clip-delete" aria-label="Delete clip" title="Delete clip" disabled={clips.length === 1} onClick={onDelete}><TbX /></Button>}
      </div>;
    })}
  </div>;
}

function SortableLayerRow({ layer, active, keyboardTarget, canReorder, onSelect, onVisibility, onRename }: {
  layer: Layer;
  active: boolean;
  keyboardTarget: boolean;
  canReorder: boolean;
  onSelect: () => void;
  onVisibility: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(layer.name);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
    disabled: !canReorder || editing,
    transition: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  });
  useEffect(() => {
    if (!editing) setDraftName(layer.name);
  }, [editing, layer.name]);
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const commitName = () => {
    const nextName = draftName.trim();
    setEditing(false);
    if (!nextName) return setDraftName(layer.name);
    if (nextName !== layer.name) onRename(nextName);
  };

  return (
    <div ref={setNodeRef} style={style} className={`stack-item${active ? " active" : ""}${keyboardTarget ? " keyboard-target" : ""}${isDragging ? " dragging" : ""}`} onPointerDownCapture={onSelect} onFocusCapture={onSelect}>
      <button type="button" className="layer-drag-handle" aria-label={`Reorder ${layer.name}`} title={canReorder ? `Drag to reorder ${layer.name}` : "Add another layer to reorder"} disabled={!canReorder || editing} {...attributes} {...listeners}><TbGripVertical /></button>
      {editing
        ? <input
            className="layer-name-input"
            aria-label={`Rename ${layer.name}`}
            autoFocus
            maxLength={128}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraftName(layer.name);
                setEditing(false);
              }
            }}
          />
        : <button type="button" className="layer-select" aria-label={`Select ${layer.name} layer`} aria-pressed={active} onClick={onSelect} onDoubleClick={() => { onSelect(); setDraftName(layer.name); setEditing(true); }}><b>{layer.name}</b></button>}
      <button type="button" className="layer-visibility" aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`} title={`${layer.visible ? "Hide" : "Show"} ${layer.name}`} aria-pressed={layer.visible} onClick={onVisibility}>{layer.visible ? <TbEye /> : <TbEyeOff />}</button>
    </div>
  );
}

function LightingMotionEditor({ document, frameIds, activeFrameId, enabled, keyframeCount, onEnabledChange, onSelectFrame, onToggleKeyframe, onInterpolationChange }: {
  document: PixelDocument;
  frameIds: string[];
  activeFrameId: string;
  enabled: boolean;
  keyframeCount: number;
  onEnabledChange: (enabled: boolean) => void;
  onSelectFrame: (frameId: string) => void;
  onToggleKeyframe: (frameId: string) => void;
  onInterpolationChange: (frameId: string, interpolation: FrameLightingInterpolation) => void;
}) {
  const activeIndex = Math.max(0, frameIds.indexOf(activeFrameId));
  const activeFrame = document.frames.find((frame) => frame.id === activeFrameId);

  return <section className="lighting-motion-editor" aria-labelledby="lighting-motion-title">
    <header>
      <span><b id="lighting-motion-title">Lighting motion</b><small>{enabled ? `${keyframeCount} keyframe${keyframeCount === 1 ? "" : "s"}` : "Same light on every frame"}</small></span>
      <button type="button" className="lighting-animation-switch" role="switch" aria-label="Animate lighting" aria-checked={enabled} onClick={() => onEnabledChange(!enabled)}>
        <span>Animate</span><i aria-hidden="true" />
      </button>
    </header>
    {enabled
      ? <>
          <div className="lighting-timeline" role="group" aria-label="Lighting timeline">
            {frameIds.map((frameId, index) => {
              const frame = document.frames.find((candidate) => candidate.id === frameId)!;
              const active = frameId === activeFrameId;
              const keyframe = Boolean(frame.lighting);
              return <div key={frameId} className={`lighting-timeline-frame${active ? " active" : ""}`}>
                <button type="button" className="lighting-frame-select" aria-label={`Select Frame ${index + 1} in lighting timeline`} aria-pressed={active} onClick={() => onSelectFrame(frameId)}>{index + 1}</button>
                <button
                  type="button"
                  className={`lighting-keyframe-marker${keyframe ? " filled" : ""}`}
                  aria-label={`${keyframe ? "Remove" : "Add"} Frame ${index + 1} lighting keyframe`}
                  aria-pressed={keyframe}
                  disabled={keyframe && keyframeCount <= 1}
                  title={keyframe && keyframeCount <= 1 ? "A clip must keep one lighting keyframe" : keyframe ? "Remove keyframe" : "Add keyframe"}
                  onClick={() => onToggleKeyframe(frameId)}
                >{keyframe ? <TbKeyframeFilled /> : <TbKeyframe />}</button>
              </div>;
            })}
          </div>
          {activeFrame?.lighting
            ? <div className="lighting-keyframe-detail">
                <span><TbKeyframeFilled /><b>{`Frame ${activeIndex + 1}`}</b></span>
                <label className="lighting-transition-select">
                  <span>Transition</span>
                  <SelectControl
                    ariaLabel="Lighting transition"
                    value={activeFrame.lightingInterpolation ?? "ease-in-out"}
                    options={lightingTransitionOptions}
                    onValueChange={(value) => onInterpolationChange(activeFrameId, value as FrameLightingInterpolation)}
                  />
                </label>
              </div>
            : <p className="lighting-interpolated-note"><TbKeyframe /><span><b>{`Frame ${activeIndex + 1} is interpolated`}</b><small>Move the light to create a keyframe.</small></span></p>}
        </>
      : <p className="lighting-static-note">Turn on Animate to move the light between frames.</p>}
  </section>;
}

function FramesList({ document, frameIds, activeFrameId, keyboardTarget, onSelect, onReorder, onDuration }: {
  document: PixelDocument;
  frameIds: string[];
  activeFrameId: string;
  keyboardTarget: boolean;
  onSelect: (frameId: string) => void;
  onReorder: (frameId: string, toIndex: number) => void;
  onDuration: (frameId: string, durationMs: number) => void;
}) {
  const frames = frameIds
    .map((frameId) => document.frames.find((frame) => frame.id === frameId))
    .filter((frame): frame is Frame => Boolean(frame));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const targetIndex = frames.findIndex((frame) => frame.id === over.id);
    if (targetIndex >= 0) onReorder(String(active.id), targetIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => onSelect(String(active.id))}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={frames.map((frame) => frame.id)} strategy={verticalListSortingStrategy}>
        <div className="frame-stack-list">
          {frames.map((frame, index) => (
            <SortableFrameRow
              key={frame.id}
              document={document}
              frame={frame}
              label={`Frame ${index + 1}`}
              active={activeFrameId === frame.id}
              keyboardTarget={keyboardTarget && activeFrameId === frame.id}
              canReorder={frames.length > 1}
              onSelect={() => onSelect(frame.id)}
              onDuration={(durationMs) => onDuration(frame.id, durationMs)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableFrameRow({ document, frame, label, active, keyboardTarget, canReorder, onSelect, onDuration }: {
  document: PixelDocument;
  frame: Frame;
  label: string;
  active: boolean;
  keyboardTarget: boolean;
  canReorder: boolean;
  onSelect: () => void;
  onDuration: (durationMs: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: frame.id,
    disabled: !canReorder,
    transition: { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div ref={setNodeRef} style={style} className={`frame-stack-item${active ? " active" : ""}${keyboardTarget ? " keyboard-target" : ""}${isDragging ? " dragging" : ""}`} onPointerDownCapture={onSelect} onFocusCapture={onSelect}>
      <button type="button" className="frame-drag-handle" aria-label={`Reorder ${label}`} title={canReorder ? `Drag to reorder ${label}` : "Add another frame to reorder"} disabled={!canReorder} {...attributes} {...listeners}><TbGripVertical /></button>
      <button type="button" className="frame-thumbnail" aria-label={`Select ${label} frame`} aria-pressed={active} onClick={onSelect}><DocumentPreview document={document} frameId={frame.id} /></button>
      <div className="frame-identity">
        <button type="button" className="frame-select" aria-label={`Select ${label}`} onClick={onSelect}><b>{label}</b></button>
        {frame.lighting && <span className="frame-lighting-keyframe" title={`Lighting keyframe · ${(frame.lightingInterpolation ?? "hold") === "linear" ? "Linear" : "Hold"}`} aria-label={`${label} lighting keyframe`}><TbKeyframeFilled /></span>}
      </div>
      <label className="frame-duration">
        <BlurNumberInput ariaLabel={`${label} duration`} min={1} max={60000} value={frame.durationMs} onCommit={onDuration} />
        <span aria-hidden="true">ms</span>
      </label>
    </div>
  );
}

function InspectorSection({ icon: Icon, title, count, countLabel = "item", action, children }: { icon: IconType; title: string; count?: number; countLabel?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="inspector-section"><header><Icon /><h2>{title}</h2>{count !== undefined && <span className="inspector-section-count" aria-label={`${count} ${countLabel}${count === 1 ? "" : "s"}`}>{count}</span>}{action}</header><div className="inspector-section-body">{children}</div></section>;
}
function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div className="control-field"><span className="control-field-label">{label}{help && <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><button type="button" className="field-help" aria-label={`About ${label}`}><TbQuestionMark /></button></TooltipTrigger><TooltipContent className="field-help-tooltip">{help}</TooltipContent></Tooltip></TooltipProvider>}</span>{children}</div>;
}
function NormalDirectionPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const [x, y, z] = packedNormalToVector(value);
  const [red, green, blue] = packedNormalToRgb(value);
  const hex = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    let nextX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    let nextY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const radius = Math.hypot(nextX, nextY);
    if (radius > 1) {
      nextX /= radius;
      nextY /= radius;
    }
    onChange(normalVectorToPacked(nextX, nextY));
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    update(event);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging) update(event);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  return <div className="normal-direction-picker">
    <div
      className="normal-direction-wheel"
      role="slider"
      tabIndex={0}
      aria-label="Normal direction"
      aria-valuetext={`X ${x.toFixed(2)}, Y ${y.toFixed(2)}, Z ${z.toFixed(2)}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.2 : 0.08;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") onChange(NEUTRAL_NORMAL);
        else onChange(normalVectorToPacked(
          x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          y + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0)
        ));
      }}
    >
      <span className="normal-direction-cursor" style={{ left: `${(x + 1) * 50}%`, top: `${(1 - y) * 50}%`, backgroundColor: hex }} />
    </div>
    <div className="normal-direction-value">
      <i style={{ backgroundColor: hex }} />
      <span><b>{hex.toUpperCase()}</b><small>{x.toFixed(2)} · {y.toFixed(2)} · {z.toFixed(2)}</small></span>
      <Button size="sm" variant="ghost" onClick={() => onChange(NEUTRAL_NORMAL)}>Reset</Button>
    </div>
  </div>;
}
function ColorAddPopover({ triggerLabel, inputLabel, color, onColorChange, onAdd, onPickFromCanvas }: {
  triggerLabel: string;
  inputLabel: string;
  color: string;
  onColorChange: (color: string) => void;
  onAdd: () => boolean;
  onPickFromCanvas: () => void;
}) {
  const [open, setOpen] = useState(false);
  const validColor = isHexColor(color);
  const addColor = () => {
    if (onAdd()) setOpen(false);
  };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="palette-swatch palette-add-trigger" aria-label={triggerLabel} title={triggerLabel}><TbPlus /></PopoverTrigger>
    <PopoverContent className="palette-add-popover" side="top" align="end" sideOffset={8}>
      <header><b>Add color</b><small>Opaque RGB color</small></header>
      <div className="palette-color-input-row">
        <input aria-label={`${inputLabel} picker`} type="color" value={validColor ? color : "#000000"} onChange={(event) => onColorChange(event.currentTarget.value)} />
        <input aria-label={inputLabel} type="text" inputMode="text" maxLength={7} spellCheck={false} value={color.toUpperCase()} onChange={(event) => onColorChange(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && validColor) addColor(); }} />
        <Button size="icon" variant="ghost" className="palette-eyedropper" aria-label="Pick color from canvas" title="Pick color from canvas" onClick={() => { setOpen(false); onPickFromCanvas(); }}><TbColorPicker /></Button>
      </div>
      <Button className="w-full" disabled={!validColor} onClick={addColor}><TbPlus />Add color</Button>
    </PopoverContent>
  </Popover>;
}
function PaletteTargetPopover({ label, palette, selectedIndex, disabled = false, onSelect }: {
  label: string;
  palette: string[];
  selectedIndex: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger className="palette-action-trigger" disabled={disabled || palette.length < 2}><TbArrowRight />{label}</PopoverTrigger>
    <PopoverContent className="palette-target-popover" side="top" align="end" sideOffset={8}>
      <header><b>{label}</b><small>Choose a destination color</small></header>
      <div className="palette-target-grid">
        {palette.map((color, index) => index === selectedIndex ? null : <button key={`${color}-${index}`} aria-label={`${label} palette ${index}: ${color}`} title={color.toUpperCase()} style={{ "--swatch": color } as CSSProperties} onClick={() => { onSelect(index); setOpen(false); }}><i /><span>{index}</span></button>)}
      </div>
    </PopoverContent>
  </Popover>;
}
function BlurNumberInput({ ariaLabel, value, min, max, disabled = false, onCommit }: { ariaLabel: string; value: number; min: number; max: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return <input aria-label={ariaLabel} type="text" inputMode="numeric" pattern="[0-9]*" value={draft} disabled={disabled} onChange={(event) => setDraft(event.currentTarget.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
function clientLabels(clients: string[]): string[] {
  return [...new Set(clients.map((client) => client.startsWith("web-") ? "WEB" : client.toUpperCase()))];
}
function sameEditableContent(left: PixelDocument, right: PixelDocument): boolean {
  const normalize = (document: PixelDocument) => {
    const next = structuredClone(document);
    next.revision = 0;
    next.metadata.modifiedBy = "";
    delete next.selection;
    return next;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function loadPresets(): ConvertSettings[] {
  try {
    const value = JSON.parse(localStorage.getItem("editable-pixel-presets") ?? "[]") as unknown;
    return Array.isArray(value) ? value.slice(-8) as ConvertSettings[] : [];
  } catch { return []; }
}
function settingsFromDocument(document: PixelDocument, fallback: ConvertSettings): ConvertSettings {
  const conversion = document.metadata.conversion;
  return conversion ? { ...fallback, canvasWidth: conversion.canvasWidth, canvasHeight: conversion.canvasHeight, colorCount: conversion.colorCount, contentScale: conversion.contentScale, alignment: conversion.alignment, dithering: conversion.dithering, background: conversion.background } : { ...fallback, canvasWidth: document.canvas.width, canvasHeight: document.canvas.height };
}
function normalizePaletteColor(color: string): string {
  return (/^#[0-9a-f]{6}$/i.test(color) ? `${color}ff` : color).toLowerCase();
}
function isHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}
function colorInputValue(color: string): string {
  return /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
}
function isTransparentPaletteColor(color: string): boolean {
  return normalizePaletteColor(color).endsWith("00");
}
function countPaletteColorUsage(document: PixelDocument, colorIndex: number): number {
  return document.layers.reduce((total, layer) => total + Object.values(layer.frames).reduce(
    (layerTotal, pixels) => layerTotal + pixels.reduce((count, pixel) => count + (pixel === colorIndex ? 1 : 0), 0),
    0
  ), 0);
}
function countPaletteColorUsageInFrame(document: PixelDocument, colorIndex: number, layerId: string, frameId: string): number {
  return getPixels(document, layerId, frameId).reduce((count, pixel) => count + (pixel === colorIndex ? 1 : 0), 0);
}
function boundsForPixelIndices(indices: readonly number[], canvasWidth: number): Pick<Selection, "x" | "y" | "width" | "height"> {
  let minX = canvasWidth;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const index of indices) {
    const x = index % canvasWidth;
    const y = Math.floor(index / canvasWidth);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
function nextFixedPaletteColor(palette: string[]): string {
  const existing = new Set(palette.map(normalizePaletteColor));
  const candidates = ["#b8ff3dff", "#ff5c35ff", "#69b7ffff", "#ffcf33ff", "#ebe8dcff", "#171a17ff"];
  const candidate = candidates.find((color) => !existing.has(color));
  if (candidate) return candidate;
  let value = (palette.length * 0x45d9f3b + 0x314159) & 0xffffff;
  let color = `#${value.toString(16).padStart(6, "0")}ff`;
  while (existing.has(color)) {
    value = (value + 0x010101) & 0xffffff;
    color = `#${value.toString(16).padStart(6, "0")}ff`;
  }
  return color;
}
function createSourceFrame(file: File, frameId: string): SourceFrameAsset {
  return {
    frameId,
    name: file.name,
    mimeType: file.type,
    sourceBlob: file,
    sourceUrl: URL.createObjectURL(file)
  };
}

async function createEmbeddedProjectSource(
  file: File,
  kind: ProjectSource["kind"],
  id = `source-${crypto.randomUUID()}`,
  createdAt = new Date().toISOString(),
  frameIds: string[] = []
): Promise<ProjectSource> {
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20MB source limit.`);
  const bytes = await readBlobBytes(file);
  return {
    id,
    name: file.name,
    kind,
    mimeType: file.type || (kind === "pixel-json" ? "application/json" : "image/png"),
    digest: await sha256Hex(bytes),
    dataBase64: bytesToBase64(bytes),
    ...(frameIds.length > 0 ? { frameIds: [...frameIds] } : {}),
    createdAt
  };
}

async function createEmbeddedSequenceProjectSource(
  files: File[],
  name: string,
  id: string,
  frameIds: string[]
): Promise<ProjectSource> {
  const frames = await createEmbeddedProjectSourceFrames(files, frameIds);
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, frames }));
  if (bytes.byteLength > 48 * 1024 * 1024) throw new Error("The embedded image sequence exceeds the 48MB project source limit.");
  return {
    id,
    name,
    kind: "image",
    mimeType: "application/x-image-sequence+json",
    digest: await sha256Hex(bytes),
    dataBase64: bytesToBase64(bytes),
    frames,
    createdAt: new Date().toISOString()
  };
}

async function createEmbeddedProjectSourceFrames(
  files: File[],
  frameIds: string[]
): Promise<NonNullable<ProjectSource["frames"]>> {
  if (files.length !== frameIds.length) throw new Error("Every retained source frame needs a matching project frame.");
  return Promise.all(files.map(async (file, index) => {
    if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} exceeds the 20MB source limit.`);
    const bytes = await readBlobBytes(file);
    return {
      frameId: frameIds[index]!,
      name: file.name,
      mimeType: file.type || "image/png",
      digest: await sha256Hex(bytes),
      dataBase64: bytesToBase64(bytes)
    };
  }));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input as unknown as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (!(reader.result instanceof ArrayBuffer)) return reject(new Error("The source file could not be read."));
      resolve(new Uint8Array(reader.result));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("The source file could not be read.")));
    reader.readAsArrayBuffer(blob);
  });
}

function sourceFramesFor(source: SourceAsset): SourceFrameAsset[] {
  if (source.sourceFrames) return source.sourceFrames;
  if (!source.sourceBlob || !source.mimeType.startsWith("image/")) return [];
  return [{
    frameId: "frame-1",
    name: source.name,
    mimeType: source.mimeType,
    sourceBlob: source.sourceBlob,
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {})
  }];
}

function sourceFrameFor(source: SourceAsset, frameId: string): SourceFrameAsset | undefined {
  return sourceFramesFor(source).find((frame) => frame.frameId === frameId);
}

function sourceFramesInDocumentOrder(source: SourceAsset, document: PixelDocument): SourceFrameAsset[] {
  const frames = new Map(sourceFramesFor(source).map((frame) => [frame.frameId, frame]));
  return document.frames.flatMap((frame) => {
    const sourceFrame = frames.get(frame.id);
    return sourceFrame ? [sourceFrame] : [];
  });
}

async function createImportedProjectContent(file: File, document: PixelDocument): Promise<{
  document: PixelDocument;
  clips: PixelProject["clips"];
  metadata: ProjectSource;
  source: SourceAsset;
}> {
  const project = createPixelProject({ document });
  const sourceId = `source-${crypto.randomUUID()}`;
  const isImage = file.type.startsWith("image/");
  const metadata = await createEmbeddedProjectSource(
    file,
    isImage ? "image" : "pixel-json",
    sourceId,
    undefined,
    isImage ? [document.frames[0]!.id] : []
  );
  return { document: project.document, clips: project.clips, metadata, source: {
    id: sourceId,
    name: file.name,
    mimeType: file.type,
    ...(isImage ? { sourceFrames: [createSourceFrame(file, document.frames[0]!.id)] } : {})
  } };
}

async function createImportedSequenceProjectContent(files: File[], document: PixelDocument): Promise<{
  document: PixelDocument;
  clips: PixelProject["clips"];
  metadata: ProjectSource;
  source: SourceAsset;
}> {
  const name = sequenceSourceName(files);
  const project = createPixelProject({ document });
  const sourceId = `source-${crypto.randomUUID()}`;
  const metadata = await createEmbeddedSequenceProjectSource(files, name, sourceId, document.frames.map((frame) => frame.id));
  return { document: project.document, clips: project.clips, metadata, source: {
    id: sourceId,
    name,
    mimeType: "application/x-image-sequence",
    sourceFrames: files.map((file, index) => createSourceFrame(file, document.frames[index]!.id))
  } };
}

function createWorkspaceSnapshot(
  project: PixelProject,
  draftSettings: ConvertSettings,
  sources: SourceAsset[],
  activeSourceId: string | undefined,
  activeInspectorTab: InspectorTab,
  savedRevision = project.revision
): WorkspaceSnapshot {
  return {
    version: 3,
    project: structuredClone(project),
    draftSettings: cloneSettings(draftSettings),
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      mimeType: source.mimeType,
      ...(source.sourceBlob ? { sourceBlob: source.sourceBlob } : {}),
      ...(source.sourceFrames ? {
        sourceFrames: source.sourceFrames.map((frame) => ({
          frameId: frame.frameId,
          name: frame.name,
          mimeType: frame.mimeType,
          sourceBlob: frame.sourceBlob
        }))
      } : {})
    })),
    ...(activeSourceId ? { activeSourceId } : {}),
    activeInspectorTab,
    savedRevision
  };
}

async function persistProjectThroughSession(
  sessionId: string,
  token: string,
  project: PixelProject,
  expectedRevision: number
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/project`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Editable-Pixel-Client": "web",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ project, expectedRevision })
    });
  } catch {
    throw new ProjectUnavailableError("The local project store is unreachable.");
  }
  const body = await response.json().catch(() => ({})) as {
    revision?: number;
    error?: { message?: string };
  };
  if (response.status === 409) throw new ProjectRevisionConflictError(body.error?.message);
  if (!response.ok) throw new ProjectUnavailableError(body.error?.message ?? "The local project store rejected the save.");
  if (body.revision !== project.revision) {
    throw new ProjectUnavailableError(`The local project store acknowledged revision ${body.revision ?? "unknown"}.`);
  }
}

function revokeSourceUrls(source: SourceAsset): void {
  if (source.sourceUrl) URL.revokeObjectURL(source.sourceUrl);
  for (const frame of source.sourceFrames ?? []) if (frame.sourceUrl) URL.revokeObjectURL(frame.sourceUrl);
}

function withProjectFrameLighting(document: PixelDocument): PixelDocument {
  if (document.frames.some((frame) => frame.lighting)) return document;
  const next = structuredClone(document);
  next.frames[0]!.lighting = { ...DEFAULT_FRAME_LIGHTING };
  return next;
}

function syncProjectClips(
  project: PixelProject,
  document: PixelDocument,
  preferredClipId?: string
): string {
  const documentFrameIds = document.frames.map((frame) => frame.id);
  const validFrameIds = new Set(documentFrameIds);
  const frameOrder = new Map(documentFrameIds.map((frameId, index) => [frameId, index]));
  const ownedFrameIds = new Set<string>();
  const clips = project.clips.map((clip) => ({
    ...clip,
    frameIds: clip.frameIds.filter((frameId) => {
      if (!validFrameIds.has(frameId) || ownedFrameIds.has(frameId)) return false;
      ownedFrameIds.add(frameId);
      return true;
    })
  }));

  let preferredClip = clips.find((clip) => clip.id === preferredClipId) ?? clips[0];
  if (!preferredClip) {
    preferredClip = { id: `clip-${crypto.randomUUID()}`, name: "Clip 1", frameIds: [] };
    clips.push(preferredClip);
  }
  preferredClip.frameIds.push(...documentFrameIds.filter((frameId) => !ownedFrameIds.has(frameId)));
  for (const clip of clips) clip.frameIds.sort((left, right) => frameOrder.get(left)! - frameOrder.get(right)!);

  project.clips = clips.filter((clip) => clip.frameIds.length > 0);
  return project.clips.some((clip) => clip.id === preferredClipId)
    ? preferredClipId!
    : project.clips[0]!.id;
}

function syncProjectSources(
  project: PixelProject,
  document: PixelDocument
): void {
  const frameIds = new Set(document.frames.map((frame) => frame.id));
  for (const source of project.sources) {
    if (source.frameIds) {
      const retained = source.frameIds.filter((frameId) => frameIds.has(frameId));
      if (retained.length > 0) source.frameIds = retained;
      else delete source.frameIds;
    }
    if (source.frames) {
      const retained = source.frames.filter((frame) => frameIds.has(frame.frameId));
      if (retained.length > 0) source.frames = retained;
      else delete source.frames;
    }
  }
}

async function splitSpriteSheet(file: File, columns: number, rows: number): Promise<File[]> {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error("Sprite sheet rows and columns must be positive whole numbers.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width % columns !== 0 || bitmap.height % rows !== 0) {
      throw new Error(`The ${bitmap.width}×${bitmap.height} image is not evenly divisible by ${columns} columns and ${rows} rows.`);
    }
    const width = bitmap.width / columns;
    const height = bitmap.height / rows;
    const tiles: File[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot split the sprite sheet.");
        context.imageSmoothingEnabled = false;
        context.drawImage(bitmap, column * width, row * height, width, height, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("A sprite frame could not be encoded.")), "image/png"));
        const base = file.name.replace(/\.[^.]+$/, "") || "sprite";
        tiles.push(new File([blob], `${base}-${String(tiles.length + 1).padStart(3, "0")}.png`, { type: "image/png" }));
      }
    }
    return tiles;
  } finally {
    bitmap.close();
  }
}

function naturalSortFiles(files: File[]): File[] {
  return [...files].sort((left, right) => left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base"
  }));
}

function sequenceSourceName(files: File[]): string {
  const names = files.map((file) => file.name.replace(/\.[^.]+$/, ""));
  const first = names[0] ?? "Animation";
  let prefix = first;
  for (const name of names.slice(1)) {
    while (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  const cleaned = prefix.replace(/[\s._-]*\d*[\s._-]*$/, "").trim();
  return cleaned || first.replace(/[\s._-]*\d+$/, "") || "Animation";
}

export function mergeFrameDocuments(
  documents: PixelDocument[],
  frameIds?: string[],
  existingFrames: PixelDocument["frames"] = []
): PixelDocument {
  const first = documents[0];
  if (!first) throw new Error("A frame sequence needs at least one converted image.");
  const next = structuredClone(first);
  const ids = documents.map((_document, index) => frameIds?.[index] ?? `frame-${index + 1}`);
  const existingFramesById = new Map(existingFrames.map((frame) => [frame.id, frame]));
  next.frames = documents.map((document, index) => {
    const existing = existingFramesById.get(ids[index]!);
    const sourceLighting = existing
      ? existing.lighting
      : index === 0
        ? document.frames[0]?.lighting
        : undefined;
    return {
      id: ids[index]!,
      name: `Frame ${index + 1}`,
      durationMs: existing?.durationMs ?? document.frames[0]?.durationMs ?? 100,
      ...(sourceLighting ? { lighting: { ...sourceLighting } } : {}),
      ...(existing?.lightingInterpolation ? { lightingInterpolation: existing.lightingInterpolation } : {})
    };
  });
  next.layers = first.layers.map((layer, layerIndex) => {
    const hasNormals = documents.some((document) => {
      const sourceLayer = document.layers[layerIndex] ?? document.layers[0]!;
      const sourceFrameId = document.frames[0]!.id;
      return Boolean(sourceLayer.normalFrames?.[sourceFrameId]);
    });
    return {
      ...structuredClone(layer),
      frames: Object.fromEntries(documents.map((document, index) => {
      const sourceLayer = document.layers[layerIndex] ?? document.layers[0]!;
      const sourceFrameId = document.frames[0]!.id;
      return [ids[index]!, remapPixels(sourceLayer.frames[sourceFrameId]!, document.palette, next.palette, next.transparentColorIndex)];
      })),
      ...(hasNormals ? {
        normalFrames: Object.fromEntries(documents.map((document, index) => {
          const sourceLayer = document.layers[layerIndex] ?? document.layers[0]!;
          const sourceFrameId = document.frames[0]!.id;
          return [
            ids[index]!,
            sourceLayer.normalFrames?.[sourceFrameId]
              ? [...sourceLayer.normalFrames[sourceFrameId]!]
              : Array.from({ length: next.canvas.width * next.canvas.height }, () => NEUTRAL_NORMAL)
          ];
        }))
      } : {})
    };
  });
  next.contentBounds = unionDocumentRects(documents.map((document) => document.contentBounds));
  next.regions = [];
  delete next.selection;
  next.id = createDocumentId({
    canvas: next.canvas,
    palette: next.palette,
    frames: next.frames,
    layers: next.layers,
    alignment: next.alignment
  });
  next.revision = 0;
  assertPixelDocument(next);
  return next;
}

export function resolveCanvasOnionSkin(
  settings: OnionSkinSettings,
  frameIds: string[],
  playing: boolean
): OnionSkinSettings {
  return {
    ...settings,
    previous: playing ? 0 : settings.previous,
    next: playing ? 0 : settings.next,
    frameIds
  };
}

function appendFrameDocuments(document: PixelDocument, frames: PixelDocument[], frameIds: string[]): PixelDocument {
  const next = structuredClone(document);
  const pixelCount = next.canvas.width * next.canvas.height;
  frames.forEach((frameDocument, index) => {
    const frameId = frameIds[index]!;
    next.frames.push({ id: frameId, name: `Frame ${next.frames.length + 1}`, durationMs: frameDocument.frames[0]?.durationMs ?? 100 });
    for (const layer of next.layers) {
      layer.frames[frameId] = new Array<number>(pixelCount).fill(next.transparentColorIndex);
      if (layer.normalFrames) layer.normalFrames[frameId] = new Array<number>(pixelCount).fill(NEUTRAL_NORMAL);
    }
    const targetLayer = next.layers[0]!;
    const sourceLayer = frameDocument.layers[0]!;
    targetLayer.frames[frameId] = remapPixels(
      sourceLayer.frames[frameDocument.frames[0]!.id]!,
      frameDocument.palette,
      next.palette,
      next.transparentColorIndex
    );
    const sourceNormal = sourceLayer.normalFrames?.[frameDocument.frames[0]!.id];
    if (sourceNormal) {
      targetLayer.normalFrames ??= Object.fromEntries(next.frames.map((frame) => [
        frame.id,
        new Array<number>(pixelCount).fill(NEUTRAL_NORMAL)
      ]));
      targetLayer.normalFrames[frameId] = [...sourceNormal];
    }
  });
  next.contentBounds = unionDocumentRects([next.contentBounds, ...frames.map((frame) => frame.contentBounds)]);
  delete next.selection;
  assertPixelDocument(next);
  return next;
}

function remapPixels(pixels: number[], sourcePalette: string[], targetPalette: string[], transparentIndex: number): number[] {
  const targetIndices = new Map(targetPalette.map((color, index) => [color.toLowerCase(), index]));
  return pixels.map((index) => targetIndices.get(sourcePalette[index]!.toLowerCase()) ?? transparentIndex);
}

function unionDocumentRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
async function convertFiles(files: File[], settings: ConvertSettings, sessionId: string | undefined, token: string | undefined): Promise<Array<{ document: PixelDocument }>> {
  if (!sessionId) throw new Error("Image conversion requires a local Editable Pixel session.");
  const form = new FormData();
  for (const file of files) form.append("image", file);
  form.append("options", JSON.stringify(settings));
  const response = await fetch(`/api/convert?session=${encodeURIComponent(sessionId)}`, { method: "POST", body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    throw new Error(failure?.error?.message ?? `Conversion failed with ${response.status}.`);
  }
  const payload = await response.json() as { document?: PixelDocument; results?: Array<{ document: PixelDocument }> };
  return payload.results ?? (payload.document ? [{ document: payload.document }] : []);
}
function DocumentPreview({ document, frameId }: { document: PixelDocument; frameId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const rendered = renderRgba(document, { frameId });
    const canvas = ref.current!; canvas.width = rendered.width; canvas.height = rendered.height;
    const copy = new Uint8ClampedArray(rendered.data.length); copy.set(rendered.data);
    canvas.getContext("2d")!.putImageData(new ImageData(copy, rendered.width, rendered.height), 0, 0);
  }, [document, frameId]);
  return <canvas ref={ref} className="document-preview" />;
}
