import {
  PatchHistory,
  addFrame,
  addLayer,
  addPaletteColor,
  applyPatch,
  clearSelection,
  createDocumentPatch,
  duplicateFrame,
  flipSelection,
  getPixels,
  moveSelection,
  pasteLayer,
  removeFrame,
  removeLayer,
  removePaletteColor,
  reorderFrame,
  reorderLayer,
  renameLayer,
  replaceColor,
  setFrameDuration,
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
import { assertPixelDocument, createDocumentId, createPixelDocument, parsePixelDocument, type Frame, type Layer, type PixelDocument, type Rect, type Selection } from "@editable-pixel/document";
import { renderRgba } from "@editable-pixel/renderer";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import {
  PiCursor, PiCursorFill, PiEraser, PiEraserFill, PiPaintBucket, PiPaintBucketFill,
  PiPencilSimple, PiPencilSimpleFill
} from "react-icons/pi";
import {
  TbAdjustments, TbArrowBackUp, TbArrowDown, TbArrowForwardUp, TbArrowLeft, TbArrowRight, TbArrowUp,
  TbChevronRight, TbColorPicker, TbCopy, TbCurrentLocation, TbDeviceFloppy, TbDownload, TbFileImport, TbFilePlus, TbFileTypePng,
  TbColumns2, TbColumns2Filled, TbFlipHorizontal, TbFlipVertical, TbGridDots, TbJson, TbMaximize,
  TbEye, TbEyeOff, TbGripVertical, TbLayersIntersect, TbPalette, TbPhotoOff, TbPlayerPlay, TbPlayerStop, TbPlus, TbRefresh, TbStack,
  TbPointerPlus, TbQuestionMark, TbTrash, TbX, TbZoomIn, TbZoomOut
} from "react-icons/tb";
import type { IconType } from "react-icons";

import { Button } from "./components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { SelectControl } from "./components/ui/select.js";
import { Sheet, SheetContent, SheetTitle } from "./components/ui/sheet.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip.js";
import { downloadDocument, downloadFramePngs, downloadLayerPngs, downloadPng, downloadSpriteSheet } from "./export.js";
import { PixelCanvas, type OnionSkinSettings, type Tool } from "./PixelCanvas.js";
import { usePixelSession, type ConnectionStatus } from "./session.js";
import {
  cloneSettings, createWorkspaceKey, loadWorkspace, restoreSourceUrls, saveWorkspace, settingsEqual,
  type ConvertSettings, type InspectorTab, type SourceAsset, type SourceFrameAsset, type Variant, type WorkspaceSnapshot
} from "./workspace.js";

const defaultSettings: ConvertSettings = {
  canvasWidth: 32, canvasHeight: 32, colorCount: 16, contentScale: 0.8,
  alignment: "center", dithering: "none", background: "alpha"
};
interface ConversionPreview {
  document: PixelDocument;
  sourceId: string;
  variantId: string;
  settings: ConvertSettings;
}
interface PendingImport {
  imageFiles: File[];
  otherFiles: File[];
}
interface PixelClipboard {
  documentId: string;
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
type KeyboardTarget = "canvas" | "layers" | "frames";
type SelectionAction = "move-left" | "move-right" | "move-up" | "move-down" | "copy" | "clear" | "flip-h" | "flip-v";

function serializePixelClipboard(copied: PixelClipboard): string {
  return JSON.stringify({
    format: "editable-pixel-selection",
    version: 1,
    width: copied.width,
    height: copied.height,
    pixels: copied.pixels,
    ...(copied.selectedOffsets ? { selectedOffsets: copied.selectedOffsets } : {})
  });
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
const canvasBackgroundPresets = ["#d8d5cc", "#f4f0e6", "#9ba097", "#51564e", "#171a17"];
const canvasBackgroundStorageKey = "editable-pixel:canvas-background";
const toolLabels: Array<{ value: Tool; key: string; label: string; icon: IconType; activeIcon: IconType }> = [
  { value: "pen", key: "P", label: "Pen", icon: PiPencilSimple, activeIcon: PiPencilSimpleFill },
  { value: "eraser", key: "E", label: "Eraser", icon: PiEraser, activeIcon: PiEraserFill },
  { value: "fill", key: "F", label: "Fill", icon: PiPaintBucket, activeIcon: PiPaintBucketFill },
  { value: "select", key: "S", label: "Select", icon: PiCursor, activeIcon: PiCursorFill }
];

export function App() {
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
  const [pixelDocument, setPixelDocument] = useState(initialDocument);
  const documentRef = useRef(pixelDocument);
  const historyRef = useRef(new PatchHistory());
  const activeIdsRef = useRef<{ sourceId?: string; variantId?: string }>({});
  const sessionDocumentPurposeRef = useRef<"load" | "conversion" | undefined>(undefined);
  const sessionHydratedRef = useRef(false);
  const previewRequestRef = useRef(0);
  const [activeLayerId, setActiveLayerId] = useState("artwork");
  const [activeFrameId, setActiveFrameId] = useState("frame-1");
  const [keyboardTarget, setKeyboardTargetState] = useState<KeyboardTarget>("canvas");
  const [tool, setTool] = useState<Tool>("select");
  const [shiftPressed, setShiftPressed] = useState(false);
  const [colorIndex, setColorIndex] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const [selectionFitRequest, setSelectionFitRequest] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [onionSkin, setOnionSkin] = useState<OnionSkinSettings>({
    previous: 1,
    next: 0,
    opacity: 0.3
  });
  const [canvasBackground, setCanvasBackground] = useState(() => {
    const saved = window.sessionStorage.getItem(canvasBackgroundStorageKey);
    return saved && /^#[0-9a-f]{6}$/i.test(saved) ? saved : canvasBackgroundPresets[0]!;
  });
  const [compareMode, setCompareMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftSettings, setDraftSettings] = useState<ConvertSettings>(defaultSettings);
  const [customCanvas, setCustomCanvas] = useState(false);
  const [presets, setPresets] = useState<ConvertSettings[]>(loadPresets);
  const [sources, setSources] = useState<SourceAsset[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>();
  const [activeVariantId, setActiveVariantId] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("convert");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"update" | "create">();
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "source" | "variant"; sourceId: string; variantId?: string }>();
  const [switchTarget, setSwitchTarget] = useState<{ sourceId: string; variantId: string }>();
  const [workspaceReady, setWorkspaceReady] = useState(false);
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
  const activeVariantButtonRef = useRef<HTMLButtonElement>(null);
  const pixelClipboardRef = useRef<PixelClipboard | undefined>(undefined);
  const layerClipboardRef = useRef<LayerClipboard | undefined>(undefined);
  const frameClipboardRef = useRef<FrameClipboard | undefined>(undefined);
  const keyboardTargetRef = useRef<KeyboardTarget>("canvas");
  const pasteFallbackRef = useRef<number | undefined>(undefined);

  const setKeyboardTarget = useCallback((target: KeyboardTarget) => {
    keyboardTargetRef.current = target;
    setKeyboardTargetState(target);
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(canvasBackgroundStorageKey, canvasBackground);
  }, [canvasBackground]);

  const replaceDocument = useCallback((next: PixelDocument, markDirty = false) => {
    documentRef.current = next;
    setPixelDocument(next);
    setActiveLayerId((current) => next.layers.some((layer) => layer.id === current) ? current : next.layers[0]!.id);
    setActiveFrameId((current) => next.frames.some((frame) => frame.id === current) ? current : next.frames[0]!.id);
    setColorIndex((current) => Math.min(current, next.palette.length - 1));
    if (markDirty) setDirty(true);
  }, []);

  const session = usePixelSession(sessionId, useCallback((next) => {
    const current = documentRef.current;
    const purpose = sessionDocumentPurposeRef.current;
    const initialHydration = !sessionHydratedRef.current;
    sessionHydratedRef.current = true;
    const externalEdit = !initialHydration && !purpose && Boolean(activeIdsRef.current.variantId) && next.revision > current.revision && !sameEditableContent(current, next);
    sessionDocumentPurposeRef.current = undefined;
    historyRef.current = new PatchHistory();
    replaceDocument(next, false);
    if (purpose === "load" || initialHydration) setDirty(false);
    else if (externalEdit || !sameEditableContent(current, next)) setDirty(true);
    setNotice(`Session synced at revision ${next.revision}.`);
  }, [replaceDocument]));
  const sessionSendPatchRef = useRef(session.sendPatch);
  sessionSendPatchRef.current = session.sendPatch;

  const activeSource = sources.find((source) => source.id === activeSourceId);
  const activeVariant = activeSource?.variants.find((variant) => variant.id === activeVariantId);
  const settingsChanged = activeVariant ? !settingsEqual(draftSettings, activeVariant.appliedSettings) : false;
  const documentChanged = activeVariant ? !sameEditableContent(pixelDocument, activeVariant.document) : false;
  const workingChanged = activeVariant ? settingsChanged || documentChanged : dirty;
  const previewForActiveVariant = conversionPreview
    && conversionPreview.sourceId === activeSource?.id
    && conversionPreview.variantId === activeVariant?.id
    ? conversionPreview
    : undefined;
  const activePreview = previewForActiveVariant && settingsEqual(previewForActiveVariant.settings, draftSettings)
    ? previewForActiveVariant
    : undefined;
  const displayDocument = pixelDocument;
  const displayLayer = displayDocument.layers.find((layer) => layer.id === activeLayerId) ?? displayDocument.layers[0]!;
  const displayLayerId = displayLayer.id;
  const displayFrame = displayDocument.frames.find((frame) => frame.id === activeFrameId) ?? displayDocument.frames[0]!;
  const displayFrameId = displayFrame.id;
  const displayFrameLabel = `Frame ${Math.max(0, displayDocument.frames.findIndex((frame) => frame.id === displayFrameId)) + 1}`;
  const activeOriginalFrame = activeSource ? sourceFrameFor(activeSource, displayFrameId) : undefined;
  const sourceThumbnailUrl = activeSource ? sourceFramesFor(activeSource)[0]?.sourceUrl : undefined;
  const activeVariantName = activeVariant?.name ?? "current";
  const selectedColorUsage = countPaletteColorUsage(pixelDocument, colorIndex);
  const currentColorUsage = countPaletteColorUsageInFrame(pixelDocument, colorIndex, displayLayerId, displayFrameId);

  useEffect(() => {
    const requestId = ++previewRequestRef.current;
    const sourceFrames = activeSource && activeVariant
      ? sourceFramesInDocumentOrder(activeSource, activeVariant.document)
      : [];
    if (!settingsChanged || sourceFrames.length === 0 || !activeSource || !activeVariant || !sessionId || session.status !== "connected") {
      if (!settingsChanged) setConversionPreview(undefined);
      setIsPreviewing(false);
      return;
    }

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
          variantId: activeVariant.id,
          settings: cloneSettings(draftSettings)
        });
        const patch = createDocumentPatch(documentRef.current, previewDocument, `Preview ${activeSource.name} conversion`);
        sessionDocumentPurposeRef.current = "conversion";
        replaceDocument(patch.after, true);
        sessionSendPatchRef.current(patch);
        setNotice(`Working copy updated from ${activeSource.name}. Save ${activeVariant.name} or save as a new version.`);
      }).catch((error) => {
        if (previewRequestRef.current !== requestId) return;
        setConversionPreview(undefined);
        setNotice(error instanceof Error ? error.message : "The conversion preview failed.");
      }).finally(() => {
        if (previewRequestRef.current === requestId) setIsPreviewing(false);
      });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [activeSource, activeVariant, draftSettings, replaceDocument, session.status, session.token, sessionId, settingsChanged]);

  useEffect(() => {
    let disposed = false;
    void loadWorkspace(workspaceLoadKey).then((snapshot) => {
      if (disposed || !snapshot || snapshot.version !== 1) return;
      const restored = restoreSourceUrls(snapshot.sources);
      setDraftSettings(snapshot.draftSettings);
      setCustomCanvas(!(snapshot.draftSettings.canvasWidth === snapshot.draftSettings.canvasHeight && standardCanvasSizes.includes(snapshot.draftSettings.canvasWidth)));
      setSources(restored);
      setActiveSourceId(snapshot.activeSourceId);
      setActiveVariantId(snapshot.activeVariantId);
      setInspectorTab(["convert", "edit", "frames"].includes(snapshot.activeInspectorTab) ? snapshot.activeInspectorTab : "convert");
      activeIdsRef.current = { sourceId: snapshot.activeSourceId, variantId: snapshot.activeVariantId };
      const source = restored.find((candidate) => candidate.id === snapshot.activeSourceId);
      const variant = source?.variants.find((candidate) => candidate.id === snapshot.activeVariantId);
      if (variant) {
        const cachedWorkingDocument = snapshot.workingDocument ?? variant.document;
        const recoveredDocument = sessionId && sessionHydratedRef.current
          ? documentRef.current
          : cachedWorkingDocument;
        replaceDocument(recoveredDocument, !sameEditableContent(variant.document, recoveredDocument));
      }
      setNotice("Recovered this tab's working session.");
    }).catch(() => {
      if (!disposed) setNotice("The editor opened, but this tab's cached source could not be recovered.");
    }).finally(() => {
      if (!disposed) {
        setWorkspaceReady(true);
        if (workspaceHandoffId) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("workspace");
          window.history.replaceState(null, "", cleanUrl);
        }
      }
    });
    return () => { disposed = true; };
  }, [replaceDocument, sessionId, workspaceHandoffId, workspaceLoadKey]);

  useEffect(() => {
    if (!workspaceReady) return;
    const timer = window.setTimeout(() => {
      const snapshot: WorkspaceSnapshot = {
        version: 1,
        draftSettings: cloneSettings(draftSettings),
        workingDocument: structuredClone(pixelDocument),
        sources: sources.map((source) => ({
          id: source.id, name: source.name, mimeType: source.mimeType,
          ...(source.sourceBlob ? { sourceBlob: source.sourceBlob } : {}),
          ...(source.sourceFrames ? {
            sourceFrames: source.sourceFrames.map((frame) => ({
              frameId: frame.frameId,
              name: frame.name,
              mimeType: frame.mimeType,
              sourceBlob: frame.sourceBlob
            }))
          } : {}),
          variants: structuredClone(source.variants)
        })),
        ...(activeSourceId ? { activeSourceId } : {}),
        ...(activeVariantId ? { activeVariantId } : {}),
        activeInspectorTab: inspectorTab
      };
      void saveWorkspace(workspaceKey, snapshot).catch(() => setNotice("This edit is live, but the refresh cache could not be updated."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeSourceId, activeVariantId, draftSettings, inspectorTab, pixelDocument, sources, workspaceKey, workspaceReady]);

  const commit = useCallback((operation: (document: PixelDocument) => Patch): Patch | undefined => {
    try {
      const current = documentRef.current;
      const patch = operation(current);
      if (patch.kind === "pixels" && patch.changes.length === 0) return undefined;
      if (sessionId) {
        if (session.status !== "connected") {
          setNotice("Wait for the local session to reconnect before editing.");
          return undefined;
        }
        replaceDocument(applyPatch(current, patch), true);
        session.sendPatch(patch);
        setNotice(`${patch.reason} sent to the local session.`);
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
    const source = getPixels(document, selection.layerId, selection.frameId);
    const pixels: number[] = [];
    const selectedIndices = selection.type === "mask" ? new Set(selection.indices) : undefined;
    const selectedOffsets: number[] = [];
    for (let y = 0; y < selection.height; y += 1) {
      for (let x = 0; x < selection.width; x += 1) {
        const sourceIndex = (selection.y + y) * document.canvas.width + selection.x + x;
        const selected = !selectedIndices || selectedIndices.has(sourceIndex);
        pixels.push(selected ? source[sourceIndex]! : document.transparentColorIndex);
        if (selectedIndices?.has(sourceIndex)) selectedOffsets.push(y * selection.width + x);
      }
    }
    const copied: PixelClipboard = {
      documentId: document.id,
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
    setNotice(`Copied ${selection.width}×${selection.height} pixels. Press ⌘V or Ctrl+V to paste.`);
    return copied;
  }, []);

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
    if (copied.pixels.some((colorIndex) => colorIndex >= current.palette.length)) {
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
      const target = next.layers.find((candidate) => candidate.id === targetLayerId)?.frames[targetFrameId];
      if (!target) throw new Error("The paste destination is no longer available.");
      if (stampSelection) {
        const colorIndex = copied.pixels[0]!;
        for (const index of selectedPixelIndices(stampSelection, next.canvas.width)) target[index] = colorIndex;
        next.selection = structuredClone(stampSelection);
        return createDocumentPatch(document, next, "Paste selection");
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
      return createDocumentPatch(document, next, "Paste selection");
    });
    copied.pasteOffset += 1;
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

  const cutSelectedPixels = useCallback(() => {
    const copied = copySelectedPixels();
    if (!copied) return undefined;
    clearSelectedPixels("Cut selection");
    return copied;
  }, [clearSelectedPixels, copySelectedPixels]);

  const copyActiveLayer = useCallback(() => {
    const document = documentRef.current;
    const layer = document.layers.find((candidate) => candidate.id === activeLayerId);
    if (!layer) return false;
    layerClipboardRef.current = { documentId: document.id, layer: structuredClone(layer) };
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
    const activeIndex = current.frames.findIndex((frame) => frame.id === activeFrameId);
    const nextFrame = current.frames[activeIndex + 1] ?? current.frames[activeIndex - 1];
    const patch = commit((document) => removeFrame(document, activeFrameId));
    if (patch && nextFrame) setActiveFrameId(nextFrame.id);
    if (patch) setPlaying(false);
    return Boolean(patch);
  }, [activeFrameId, commit]);

  const setSelection = useCallback((selection: Selection | undefined) => {
    const current = documentRef.current;
    if (JSON.stringify(current.selection) === JSON.stringify(selection)) return;
    const next = structuredClone(current);
    if (selection) next.selection = selection;
    else delete next.selection;
    const patch = createDocumentPatch(current, next, selection ? "Set selection" : "Clear selection");
    replaceDocument(sessionId ? patch.after : historyRef.current.apply(current, patch), false);
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
      setNotice("Undo");
    } else if (sessionId) session.requestUndo();
  }, [replaceDocument, session, sessionId]);

  const redo = useCallback(() => {
    const current = documentRef.current;
    const next = historyRef.current.redo(current);
    if (next !== current) {
      const contentChanged = !sameEditableContent(current, next);
      replaceDocument(next, contentChanged);
      setNotice("Redo");
    } else if (sessionId) session.requestRedo();
  }, [replaceDocument, session, sessionId]);

  useEffect(() => {
    if (!activeOriginalFrame?.sourceUrl) setCompareMode(false);
  }, [activeOriginalFrame?.sourceUrl]);

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
    activeVariantButtonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeSource?.variants.length, activeSourceId, activeVariantId]);

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
      if (keyboardTargetRef.current === "frames") {
        if (command && event.key.toLowerCase() === "c") {
          event.preventDefault();
          copyActiveFrame();
          return;
        }
        if (command && event.key.toLowerCase() === "v") {
          event.preventDefault();
          pasteCopiedFrame();
          return;
        }
        if (command && event.key.toLowerCase() === "x") {
          event.preventDefault();
          return;
        }
        if (!command && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          removeActiveFrameFromKeyboard();
          return;
        }
      }
      if (keyboardTargetRef.current === "layers") {
        if (command && event.key.toLowerCase() === "c") {
          event.preventDefault();
          copyActiveLayer();
          return;
        }
        if (command && event.key.toLowerCase() === "v") {
          event.preventDefault();
          pasteCopiedLayer();
          return;
        }
        if (command && event.key.toLowerCase() === "x") {
          event.preventDefault();
          return;
        }
        if (!command && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault();
          removeActiveLayerFromKeyboard();
          return;
        }
      }
      if (command && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (!window.document.execCommand("copy")) copySelectedPixels();
        return;
      }
      if (command && event.key.toLowerCase() === "x") {
        event.preventDefault();
        if (!window.document.execCommand("cut")) {
          const copied = cutSelectedPixels();
          if (copied) void navigator.clipboard?.writeText(serializePixelClipboard(copied)).catch(() => undefined);
        }
        return;
      }
      if (command && event.key.toLowerCase() === "v" && pixelClipboardRef.current) {
        if (pasteFallbackRef.current !== undefined) window.clearTimeout(pasteFallbackRef.current);
        pasteFallbackRef.current = window.setTimeout(() => {
          pasteFallbackRef.current = undefined;
          pasteCopiedPixels();
        }, 0);
        return;
      }
      if (!command && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (documentRef.current.selection) {
          event.preventDefault();
          clearSelectedPixels();
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
  }, [clearSelectedPixels, colorPickTarget, compareMode, copyActiveFrame, copyActiveLayer, copySelectedPixels, cutSelectedPixels, pasteCopiedFrame, pasteCopiedLayer, pasteCopiedPixels, redo, removeActiveFrameFromKeyboard, removeActiveLayerFromKeyboard, setSelection, undo]);

  useEffect(() => {
    if (!playing || pixelDocument.frames.length < 2) return;
    const frame = pixelDocument.frames.find((candidate) => candidate.id === activeFrameId) ?? pixelDocument.frames[0]!;
    const timer = window.setTimeout(() => {
      const index = pixelDocument.frames.findIndex((candidate) => candidate.id === frame.id);
      setActiveFrameId(pixelDocument.frames[(index + 1) % pixelDocument.frames.length]!.id);
    }, frame.durationMs);
    return () => window.clearTimeout(timer);
  }, [activeFrameId, pixelDocument.frames, playing]);

  const sendDocument = useCallback((next: PixelDocument, reason: string, purpose: "load" | "conversion") => {
    historyRef.current = new PatchHistory();
    if (sessionId) {
      if (session.status !== "connected") throw new Error("Wait for the local session to reconnect first.");
      const patch = createDocumentPatch(documentRef.current, next, reason);
      sessionDocumentPurposeRef.current = purpose;
      replaceDocument(patch.after, false);
      session.sendPatch(patch);
    } else replaceDocument(next, false);
    setDirty(false);
  }, [replaceDocument, session, sessionId]);

  const performImport = useCallback(async (files: File[], imageMode: "sequence" | "separate") => {
    if (files.length === 0) return;
    if (sessionId && session.status !== "connected") return setNotice("Wait for the local session to reconnect before importing.");
    setIsImporting(true);
    setNotice(`Converting ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const imported: SourceAsset[] = [];
      const imageFiles: File[] = [];
      for (const file of files) {
        if (file.name.endsWith(".pixel.json") || file.type === "application/json") {
          const document = parsePixelDocument(await file.text());
          imported.push(createSource(file, document, settingsFromDocument(document, draftSettings)));
        } else imageFiles.push(file);
      }
      if (imageFiles.length > 0) {
        if (imageMode === "sequence") {
          const results = await convertFiles(imageFiles, draftSettings, sessionId, session.token);
          const document = mergeFrameDocuments(results.map((result) => result.document));
          imported.unshift(createSequenceSource(imageFiles, document, draftSettings));
        } else {
          const results = await Promise.all(imageFiles.map(async (file) => {
            const [result] = await convertFiles([file], draftSettings, sessionId, session.token);
            if (!result) throw new Error(`${file.name} could not be converted.`);
            return result;
          }));
          for (const [index, result] of results.entries()) imported.push(createSource(imageFiles[index]!, result.document, draftSettings));
        }
      }
      const first = imported[0];
      if (!first) throw new Error("No supported source was found.");
      const firstVariant = first.variants[0]!;
      setSources((current) => [...current, ...imported]);
      setActiveSourceId(first.id); setActiveVariantId(firstVariant.id);
      activeIdsRef.current = { sourceId: first.id, variantId: firstVariant.id };
      sendDocument(firstVariant.document, `Import and normalize ${first.name}`, "conversion");
      if (imageMode === "sequence" && imageFiles.length > 1) {
        setInspectorTab("frames");
        setNotice(`${imageFiles.length} images are ready as one animation with ${imageFiles.length} frames.`);
      } else {
        setNotice(`${imported.length} source${imported.length === 1 ? "" : "s"} ready. The original is kept for reconversion.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed.");
    } finally { setIsImporting(false); }
  }, [draftSettings, sendDocument, session.status, session.token, sessionId]);

  const requestImport = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const imageFiles = naturalSortFiles(files.filter((file) => file.type.startsWith("image/")));
    const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
    if (imageFiles.length > 1) {
      setPendingImport({ imageFiles, otherFiles });
      return;
    }
    void performImport([...otherFiles, ...imageFiles], "separate");
  }, [performImport]);

  const importFramesIntoCurrent = useCallback(async (files: File[]) => {
    const imageFiles = naturalSortFiles(files.filter((file) => file.type.startsWith("image/")));
    if (imageFiles.length === 0) return setNotice("Choose one or more PNG, WebP, or JPEG images.");
    if (!activeSource || !activeVariant) {
      await performImport(imageFiles, "sequence");
      return;
    }
    if (sessionId && session.status !== "connected") return setNotice("Wait for the local session to reconnect before importing frames.");
    setIsImporting(true);
    setNotice(`Adding ${imageFiles.length} frame${imageFiles.length === 1 ? "" : "s"}…`);
    try {
      const settings = {
        ...draftSettings,
        colorCount: pixelDocument.palette.length,
        palette: [...pixelDocument.palette]
      };
      const results = await convertFiles(imageFiles, settings, sessionId, session.token);
      const frameIds = results.map(() => `frame-${crypto.randomUUID()}`);
      const next = appendFrameDocuments(documentRef.current, results.map((result) => result.document), frameIds);
      const patch = commit((document) => createDocumentPatch(document, next, `Add ${results.length} image frame${results.length === 1 ? "" : "s"}`));
      if (!patch || patch.kind !== "document") return;
      const sourceFrames = imageFiles.map((file, index) => createSourceFrame(file, frameIds[index]!));
      setSources((current) => current.map((source) => source.id === activeSource.id
        ? { ...source, sourceFrames: [...sourceFramesFor(source), ...sourceFrames] }
        : source));
      setActiveFrameId(frameIds.at(-1)!);
      setInspectorTab("frames");
      setNotice(`Added ${results.length} image frame${results.length === 1 ? "" : "s"} to ${activeVariant.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The frames could not be imported.");
    } finally {
      setIsImporting(false);
    }
  }, [activeSource, activeVariant, commit, draftSettings, performImport, pixelDocument.palette, session.status, session.token, sessionId]);

  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      if (typing) return;
      if (keyboardTargetRef.current === "frames") {
        event.preventDefault();
        copyActiveFrame();
        return;
      }
      if (keyboardTargetRef.current === "layers") {
        event.preventDefault();
        copyActiveLayer();
        return;
      }
      const copied = copySelectedPixels();
      if (!copied || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serializePixelClipboard(copied));
    };
    window.addEventListener("copy", onCopy);
    return () => window.removeEventListener("copy", onCopy);
  }, [copyActiveFrame, copyActiveLayer, copySelectedPixels]);

  useEffect(() => {
    const onCut = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']");
      if (typing) return;
      if (keyboardTargetRef.current === "frames" || keyboardTargetRef.current === "layers") {
        event.preventDefault();
        return;
      }
      const copied = cutSelectedPixels();
      if (!copied || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", serializePixelClipboard(copied));
    };
    window.addEventListener("cut", onCut);
    return () => window.removeEventListener("cut", onCut);
  }, [cutSelectedPixels]);

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
      } else if (keyboardTargetRef.current === "frames") {
        event.preventDefault();
        pasteCopiedFrame();
      } else if (keyboardTargetRef.current === "layers") {
        event.preventDefault();
        pasteCopiedLayer();
      } else if (pixelClipboardRef.current) {
        event.preventDefault();
        pasteCopiedPixels();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
      if (pasteFallbackRef.current !== undefined) window.clearTimeout(pasteFallbackRef.current);
    };
  }, [pasteCopiedFrame, pasteCopiedLayer, pasteCopiedPixels, requestImport]);

  const selectVariant = (source: SourceAsset, variant: Variant) => {
    try {
      previewRequestRef.current += 1;
      setConversionPreview(undefined);
      setIsPreviewing(false);
      setSwitchTarget(undefined);
      setDeleteTarget(undefined);
      setActiveSourceId(source.id); setActiveVariantId(variant.id);
      activeIdsRef.current = { sourceId: source.id, variantId: variant.id };
      setDraftSettings(cloneSettings(variant.appliedSettings));
      setCustomCanvas(!(variant.appliedSettings.canvasWidth === variant.appliedSettings.canvasHeight && standardCanvasSizes.includes(variant.appliedSettings.canvasWidth)));
      sendDocument(variant.document, `Switch to ${source.name} / ${variant.name}`, "load");
      setNotice(`Viewing ${source.name} / ${variant.name}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The variant could not be opened."); }
  };

  const requestVariantSelection = (source: SourceAsset, variant: Variant) => {
    if (source.id === activeSourceId && variant.id === activeVariantId) return;
    if (workingChanged) {
      setSwitchTarget({ sourceId: source.id, variantId: variant.id });
      setNotice(`Save ${activeVariantName} before switching, or discard the working changes.`);
      return;
    }
    selectVariant(source, variant);
  };

  const confirmVariantSwitch = () => {
    if (!switchTarget) return;
    const source = sources.find((candidate) => candidate.id === switchTarget.sourceId);
    const variant = source?.variants.find((candidate) => candidate.id === switchTarget.variantId);
    if (source && variant) selectVariant(source, variant);
    else setSwitchTarget(undefined);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const source = sources.find((candidate) => candidate.id === deleteTarget.sourceId);
    if (!source) return setDeleteTarget(undefined);
    const variant = deleteTarget.variantId ? source.variants.find((candidate) => candidate.id === deleteTarget.variantId) : undefined;
    const removesSource = deleteTarget.kind === "source" || source.variants.length === 1;
    const changesActiveDocument = source.id === activeSourceId && (removesSource || variant?.id === activeVariantId);
    if (changesActiveDocument && sessionId && session.status !== "connected") {
      setNotice("Wait for the local session to reconnect before deleting the active source or variant.");
      return;
    }

    if (removesSource) {
      const remainingSources = sources.filter((candidate) => candidate.id !== source.id);
      setSources(remainingSources);
      setDeleteTarget(undefined);
      if (source.sourceUrl) URL.revokeObjectURL(source.sourceUrl);
      for (const frame of source.sourceFrames ?? []) {
        if (frame.sourceUrl) URL.revokeObjectURL(frame.sourceUrl);
      }
      if (source.id !== activeSourceId) {
        setNotice(`Deleted ${source.name} and its variants.`);
        return;
      }
      const fallbackSource = remainingSources[0];
      const fallbackVariant = fallbackSource?.variants[0];
      if (fallbackSource && fallbackVariant) {
        selectVariant(fallbackSource, fallbackVariant);
        setNotice(`Deleted ${source.name} and switched to ${fallbackSource.name} / ${fallbackVariant.name}.`);
      } else {
        setActiveSourceId(undefined); setActiveVariantId(undefined);
        activeIdsRef.current = {};
        setDraftSettings(cloneSettings(defaultSettings)); setCustomCanvas(false); setCompareMode(false);
        sendDocument(structuredClone(initialDocument), `Delete ${source.name}`, "load");
        setNotice(`Deleted ${source.name}. The blank canvas is ready.`);
      }
      return;
    }

    if (!variant) return setDeleteTarget(undefined);
    const deletedIndex = source.variants.findIndex((candidate) => candidate.id === variant.id);
    const remainingVariants = source.variants.filter((candidate) => candidate.id !== variant.id);
    const nextSource = { ...source, variants: remainingVariants };
    setSources((current) => current.map((candidate) => candidate.id === source.id ? nextSource : candidate));
    setDeleteTarget(undefined);
    if (source.id === activeSourceId && variant.id === activeVariantId) {
      const fallbackVariant = remainingVariants[Math.min(deletedIndex, remainingVariants.length - 1)]!;
      selectVariant(nextSource, fallbackVariant);
      setNotice(`Deleted ${variant.name} and switched to ${fallbackVariant.name}.`);
    } else setNotice(`Deleted ${source.name} / ${variant.name}.`);
  };

  const saveVersion = async (mode: "update" | "create") => {
    if (!activeSource || !activeVariant) return setNotice("Import an image or Pixel JSON before saving a version.");
    if (settingsChanged && !activePreview) return setNotice("Wait for the conversion preview to finish before saving.");
    setSaveMode(mode);
    try {
      const createVariant = mode === "create";
      const savedDocument = structuredClone(documentRef.current);
      const containsPixelEdits = activePreview
        ? !sameEditableContent(savedDocument, activePreview.document)
        : activeVariant.hasEditsSinceConversion || !sameEditableContent(savedDocument, activeVariant.document);
      const nextVariant: Variant = {
        id: createVariant ? crypto.randomUUID() : activeVariant.id,
        name: createVariant ? `V${activeSource.variants.length + 1}` : activeVariant.name,
        document: savedDocument, appliedSettings: cloneSettings(draftSettings),
        hasEditsSinceConversion: containsPixelEdits, createdAt: createVariant ? new Date().toISOString() : activeVariant.createdAt
      };
      setSources((current) => current.map((source) => source.id !== activeSource.id ? source : {
        ...source,
        variants: createVariant
          ? [...source.variants, nextVariant]
          : source.variants.map((variant) => variant.id === activeVariant.id ? nextVariant : variant)
      }));
      setActiveVariantId(nextVariant.id);
      activeIdsRef.current = { sourceId: activeSource.id, variantId: nextVariant.id };
      previewRequestRef.current += 1;
      setConversionPreview(undefined);
      setIsPreviewing(false);
      setDirty(false);
      setSwitchTarget(undefined);
      setNotice(createVariant
        ? `Saved as ${nextVariant.name}; ${activeVariant.name} was preserved.`
        : `Saved ${activeVariant.name}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The version could not be saved."); }
    finally { setSaveMode(undefined); }
  };

  const savePreset = () => {
    const next = [...presets, structuredClone(draftSettings)].slice(-8);
    setPresets(next); localStorage.setItem("editable-pixel-presets", JSON.stringify(next));
    setNotice("Conversion preset saved in this browser.");
  };
  const loadPreset = (index: number) => {
    const preset = presets[index];
    if (!preset) return;
    setDraftSettings(structuredClone(preset));
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
    setDraftSettings((current) => ({
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
    setDraftSettings((current) => ({
      ...current,
      palette: current.palette?.map((color, colorIndex) => colorIndex === index ? nextColor : color)
    }));
  };
  const removeFixedPaletteColor = (index: number) => {
    setDraftSettings((current) => {
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
    setDraftSettings((current) => ({ ...current, contentScale: preset === "tight" ? 1 : 0.8 }));
  };
  const setContentScalePercent = (percent: number) => {
    if (!Number.isFinite(percent)) return;
    const clamped = Math.min(100, Math.max(25, percent));
    setDraftSettings((current) => ({ ...current, contentScale: clamped / 100 }));
  };
  const addNewFrame = () => {
    const patch = commit((document) => addFrame(document, `Frame ${document.frames.length + 1}`));
    if (patch?.kind !== "document") return;
    const added = patch.after.frames.at(-1);
    if (added) setActiveFrameId(added.id);
  };
  const renderSourceVariants = () => (
    <InspectorSection icon={TbRefresh} title="Source Variants">
      {activeSource ? <div className="source-browser">
        <div className="source-picker-row">
          <SelectControl
            ariaLabel="Source asset"
            value={activeSource.id}
            options={sources.map((source) => ({ value: source.id, label: source.name }))}
            onValueChange={(sourceId) => {
              const source = sources.find((candidate) => candidate.id === sourceId);
              const variant = source?.variants.find((candidate) => candidate.id === activeVariantId) ?? source?.variants[0];
              if (source && variant) requestVariantSelection(source, variant);
            }}
          />
          <Button size="icon" variant="ghost" className="source-delete" aria-label={`Delete ${activeSource.name} and all versions`} title={`Delete ${activeSource.name}`} onClick={() => setDeleteTarget({ kind: "source", sourceId: activeSource.id })}><TbTrash /></Button>
        </div>
        <div className="source-controls">
          <div className="source-preview" title={activeSource.name}>
            {sourceThumbnailUrl ? <img src={sourceThumbnailUrl} alt={`${activeSource.name} source`} /> : <TbDeviceFloppy aria-label={`${activeSource.name} Pixel document`} />}
          </div>
          <span className="source-divider" aria-hidden="true" />
          <div className="variant-row" aria-label={`${activeSource.name} variants`}>{activeSource.variants.map((variant) => {
            const isActiveVariant = variant.id === activeVariantId;
            const isEdited = variant.hasEditsSinceConversion || (isActiveVariant && workingChanged);
            return <div key={variant.id} className={isActiveVariant ? "variant-control active" : "variant-control"}>
              <button ref={isActiveVariant ? activeVariantButtonRef : undefined} className={`${isActiveVariant ? "variant-select active" : "variant-select"}${isEdited ? " edited" : ""}`} aria-label={`${activeSource.name} ${variant.name}${isEdited ? ", edited" : ""}`} title={isEdited ? `${variant.name} · Edited` : variant.name} onClick={() => requestVariantSelection(activeSource, variant)}>{isEdited && <i aria-hidden="true" />}{variant.name}</button>
              <Button size="icon" variant="ghost" className="item-delete" aria-label={`Delete ${activeSource.name} ${variant.name}`} title={`Delete ${variant.name}`} onClick={() => setDeleteTarget({ kind: "variant", sourceId: activeSource.id, variantId: variant.id })}><TbX /></Button>
            </div>;
          })}</div>
        </div>
        {deleteTarget?.sourceId === activeSource.id && <div className="delete-confirm" role="alert">
          <span><b>{deleteTarget.kind === "source" ? `Delete ${activeSource.name} and ${activeSource.variants.length} version${activeSource.variants.length === 1 ? "" : "s"}?` : activeSource.variants.length === 1 ? `Delete ${activeSource.variants.find((variant) => variant.id === deleteTarget.variantId)?.name} and delete ${activeSource.name}?` : `Delete ${activeSource.variants.find((variant) => variant.id === deleteTarget.variantId)?.name}?`}</b><small>{deleteTarget.kind === "source" ? "The source and all versions will be removed." : activeSource.variants.length === 1 ? "Removing the only version also removes its source." : "Only this version will be removed."}</small></span>
          <div><Button size="sm" variant="ghost" onClick={() => setDeleteTarget(undefined)}>Cancel</Button><Button size="sm" className="delete-confirm-button" onClick={confirmDelete}>Delete</Button></div>
        </div>}
      </div> : <div className="source-note"><TbPhotoOff /><span><b>No source asset</b><small>Import an image or Pixel JSON from the header, or drop either anywhere.</small></span></div>}
      {switchTarget && <div className="delete-confirm switch-confirm" role="alert">
        <span><b>Discard unsaved changes?</b><small>Save {activeVariantName} first, or switch versions without keeping this working copy.</small></span>
        <div><Button size="sm" variant="ghost" onClick={() => setSwitchTarget(undefined)}>Cancel</Button><Button size="sm" className="delete-confirm-button" onClick={confirmVariantSwitch}>Discard and switch</Button></div>
      </div>}
    </InspectorSection>
  );

  const renderInspector = () => (
    <div className="inspector-shell">
      <div className="inspector-source-panel">{renderSourceVariants()}</div>
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
            else { const size = +value; setCustomCanvas(false); setDraftSettings((current) => ({ ...current, canvasWidth: size, canvasHeight: size })); }
          }} /></Field>
          {customCanvas && <div className="dimension-row"><BlurNumberInput ariaLabel="Canvas width" min={1} max={4096} value={draftSettings.canvasWidth} onCommit={(canvasWidth) => setDraftSettings((current) => ({ ...current, canvasWidth }))} /><b>×</b><BlurNumberInput ariaLabel="Canvas height" min={1} max={4096} value={draftSettings.canvasHeight} onCommit={(canvasHeight) => setDraftSettings((current) => ({ ...current, canvasHeight }))} /></div>}
          <div className="field-grid">
            <Field label="Colors"><BlurNumberInput ariaLabel="Color count" min={2} max={256} value={draftSettings.colorCount} onCommit={(colorCount) => setDraftSettings((current) => ({ ...current, colorCount }))} /></Field>
            <Field label="Anchor"><SelectControl ariaLabel="Content alignment" value={draftSettings.alignment} options={alignmentOptions} onValueChange={(value) => setDraftSettings((current) => ({ ...current, alignment: value as ConvertSettings["alignment"] }))} /></Field>
            <Field label="Background" help="Alpha keeps transparency already in the image. Solid removes a flat background sampled from the top-left corner."><SelectControl ariaLabel="Background mode" value={draftSettings.background} options={backgroundOptions} onValueChange={(value) => setDraftSettings((current) => ({ ...current, background: value as ConvertSettings["background"] }))} /></Field>
            <Field label="Dither" help="Floyd mixes nearby palette colors into a pixel pattern to preserve gradients. None keeps color areas flat and crisp."><SelectControl ariaLabel="Dithering" value={draftSettings.dithering} options={ditheringOptions} onValueChange={(value) => setDraftSettings((current) => ({ ...current, dithering: value as ConvertSettings["dithering"] }))} /></Field>
          </div>
          <Field label="Fixed Palette">
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
              <small>{draftSettings.palette?.length ? `${draftSettings.palette.length} fixed color${draftSettings.palette.length === 1 ? "" : "s"} · transparency added automatically` : "Auto from source · add colors to lock the palette"}</small>
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
        <InspectorSection icon={TbPalette} title="Palette">
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
        </InspectorSection>

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

      <TabsContent value="frames">
        <InspectorSection icon={TbLayersIntersect} title="Onion Skin">
          <div className={`onion-skin-settings${pixelDocument.frames.length < 2 ? " disabled" : ""}`}>
            <div className="onion-frame-toggles">
              <button
                type="button"
                className="onion-frame-toggle"
                role="switch"
                aria-label="Show previous frame"
                aria-checked={onionSkin.previous > 0}
                disabled={pixelDocument.frames.length < 2}
                onClick={() => setOnionSkin((current) => ({ ...current, previous: current.previous > 0 ? 0 : 1 }))}
              >
                <span>Previous</span><i aria-hidden="true" />
              </button>
              <button
                type="button"
                className="onion-frame-toggle"
                role="switch"
                aria-label="Show next frame"
                aria-checked={onionSkin.next > 0}
                disabled={pixelDocument.frames.length < 2}
                onClick={() => setOnionSkin((current) => ({ ...current, next: current.next > 0 ? 0 : 1 }))}
              >
                <span>Next</span><i aria-hidden="true" />
              </button>
            </div>
            <Field label="Opacity">
              <div className="onion-opacity-control">
                <input
                  aria-label="Onion skin opacity"
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.05"
                  value={onionSkin.opacity}
                  disabled={pixelDocument.frames.length < 2}
                  onChange={(event) => setOnionSkin((current) => ({ ...current, opacity: event.currentTarget.valueAsNumber }))}
                />
                <output>{Math.round(onionSkin.opacity * 100)}%</output>
              </div>
            </Field>
          </div>
        </InspectorSection>

        <InspectorSection
          icon={TbPlayerPlay}
          title="Frames"
          count={pixelDocument.frames.length}
          action={<div className="inspector-section-actions">
            <Button size="icon" variant="ghost" className="inspector-section-action" aria-label={playing ? "Stop" : "Play"} title={playing ? "Stop playback" : "Play frames"} disabled={pixelDocument.frames.length < 2} onClick={() => setPlaying((current) => !current)}>{playing ? <TbPlayerStop /> : <TbPlayerPlay />}</Button>
            <Button size="icon" variant="ghost" className="inspector-section-action" aria-label="Add blank frame" title="Add blank frame" onClick={addNewFrame}><TbFilePlus /></Button>
            <Button size="icon" variant="ghost" className="inspector-section-action" aria-label="Add image frames" title="Add image frames" onClick={() => frameInputRef.current?.click()} disabled={isImporting}><TbPlus /></Button>
            <input ref={frameInputRef} aria-label="Import frame images" hidden type="file" multiple accept="image/png,image/webp,image/jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => {
              void importFramesIntoCurrent([...event.target.files ?? []]);
              event.currentTarget.value = "";
            }} />
          </div>}
        >
          <FramesList
            document={pixelDocument}
            activeFrameId={activeFrameId}
            keyboardTarget={keyboardTarget === "frames"}
            onSelect={(frameId) => { setActiveFrameId(frameId); setKeyboardTarget("frames"); }}
            onReorder={(frameId, toIndex) => commit((document) => reorderFrame(document, frameId, toIndex))}
            onDuration={(frameId, durationMs) => commit((document) => setFrameDuration(document, frameId, durationMs))}
          />
        </InspectorSection>
      </TabsContent>

      </Tabs>
      <div className="inspector-sticky-action">
        <div className="conversion-actions">
          <Button variant="default" className={workingChanged ? "conversion-action has-changes" : "conversion-action"} onClick={() => void saveVersion("update")} disabled={isImporting || isPreviewing || !activeVariant || (settingsChanged && !activePreview)}><TbDeviceFloppy className="shrink-0" />{saveMode === "update" ? "Saving…" : "Save"}</Button>
          <Button variant="default" onClick={() => void saveVersion("create")} disabled={isImporting || isPreviewing || !activeVariant || (settingsChanged && !activePreview)}><TbCopy className="shrink-0" />{saveMode === "create" ? "Saving…" : "Save As"}</Button>
        </div>
      </div>
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
        <div className="header-actions">
          <Button size="icon" variant="ghost" aria-label="Import" title="Import image or Pixel JSON" onClick={() => fileInputRef.current?.click()} disabled={isImporting}><TbFileImport /></Button>
          <ExportPopover document={displayDocument} frameId={displayFrameId} />
          <Button variant="ghost" className="mobile-inspector-trigger" aria-label="Open inspector" onClick={() => setInspectorOpen(true)}><TbAdjustments /></Button>
          <input ref={fileInputRef} aria-label="Import files" hidden type="file" multiple accept="image/png,image/webp,image/jpeg,.pixel.json,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => {
            requestImport([...event.target.files ?? []]);
            event.currentTarget.value = "";
          }} />
        </div>
      </header>

      <section className="workbench">
        <section className="canvas-column">
          <div className="canvas-toolbar"><span className="toolbar-frame" title={displayFrameLabel}>{displayFrameLabel}</span><span className="toolbar-separator">/</span><span className="toolbar-layer" title={displayLayer.name}>{displayLayer.name}</span><div className="toolbar-spacer" /><div className="history-control"><IconButton label="Undo" icon={TbArrowBackUp} onClick={undo} disabled={!sessionId && !historyRef.current.canUndo} /><IconButton label="Redo" icon={TbArrowForwardUp} onClick={redo} disabled={!sessionId && !historyRef.current.canRedo} /></div><div className="view-control"><IconButton label="Toggle grid" icon={TbGridDots} active={showGrid} aria-pressed={showGrid} onClick={() => setShowGrid((current) => !current)} /><IconButton label="Compare original" icon={compareMode ? TbColumns2Filled : TbColumns2} className={compareMode ? "view-active" : ""} aria-pressed={compareMode} title={activeOriginalFrame?.sourceUrl ? "Compare original" : "Original unavailable"} onClick={() => setCompareMode((current) => activeOriginalFrame?.sourceUrl ? !current : false)} disabled={!activeOriginalFrame?.sourceUrl} /></div><div className="zoom-control"><IconButton label="Zoom out" icon={TbZoomOut} onClick={() => setZoom((current) => Math.max(1, current - 1))} /><span>{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" icon={TbZoomIn} onClick={() => setZoom((current) => Math.min(48, current + 1))} /></div><Button size="sm" variant="ghost" onClick={() => setFitRequest((current) => current + 1)}>Fit</Button></div>

          <div className="canvas-surface" aria-busy={isPreviewing}>
            <PixelCanvas document={displayDocument} layerId={displayLayerId} frameId={displayFrameId} tool={tool} colorIndex={colorIndex} zoom={zoom} showGrid={showGrid} onionSkin={onionSkin} canvasBackground={canvasBackground} referenceImageUrl={activeOriginalFrame?.sourceUrl} compareMode={compareMode} colorPickMode={Boolean(colorPickTarget)} keyboardTarget={keyboardTarget === "canvas"} fitRequest={fitRequest} selectionFitRequest={selectionFitRequest} onFitZoom={setZoom} onZoom={setZoom} onActivate={() => setKeyboardTarget("canvas")} onEdit={commit} onSelection={setSelection} onPickColor={(color) => {
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
            {colorPickTarget && <div className="canvas-color-pick-hint"><TbColorPicker /><span><b>Pick a color</b><small>Click a canvas pixel · Esc to cancel</small></span></div>}
            <SessionStatus sessionId={sessionId} status={session.status} host={session.host} clients={session.clients} revision={pixelDocument.revision} workingChanged={workingChanged} selection={pixelDocument.selection} hasPendingPatch={Boolean(session.pendingPatch)} />
            {pixelDocument.selection && <SelectionDock onAction={selectionAction} />}
            <ToolDock tool={tool} shiftPressed={shiftPressed} onTool={setTool} />
            <ShortcutHelp />
          </div>
          <footer className="canvas-footer"><span>{notice}</span><span>{displayDocument.selection ? displayDocument.selection.type === "mask" ? `Editing within selection · ${displayDocument.selection.indices.length.toLocaleString()} pixels · Esc to clear` : `Editing within selection · ${displayDocument.selection.x},${displayDocument.selection.y} / ${displayDocument.selection.width}×${displayDocument.selection.height} · Esc to clear` : "No selection"}</span></footer>
        </section>
        <aside className="inspector desktop-inspector">{renderInspector()}</aside>
      </section>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}><SheetContent className="mobile-inspector"><div className="sheet-header"><SheetTitle>Inspector</SheetTitle><Button size="icon" variant="ghost" aria-label="Close inspector" onClick={() => setInspectorOpen(false)}><TbX /></Button></div>{renderInspector()}</SheetContent></Sheet>

      {pendingImport && <SequenceImportDialog
        files={pendingImport.imageFiles}
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
        onSequence={() => {
          const files = [...pendingImport.otherFiles, ...pendingImport.imageFiles];
          setPendingImport(undefined);
          void performImport(files, "sequence");
        }}
        onSeparate={() => {
          const files = [...pendingImport.otherFiles, ...pendingImport.imageFiles];
          setPendingImport(undefined);
          void performImport(files, "separate");
        }}
      />}

      {session.pendingPatch && <section className="patch-drawer"><div><small>AGENT PATCH / REVIEW REQUIRED</small><h2>{session.pendingPatch.patch.reason}</h2><p>{session.pendingPatch.patch.kind !== "document" ? `${session.pendingPatch.patch.changes.length} pixels inside ${session.pendingPatch.patch.bounds.width}×${session.pendingPatch.patch.bounds.height}${session.pendingPatch.patch.kind === "palette-pixels" ? ` · +${session.pendingPatch.patch.newColors.length} colors` : ""}` : "Document structure change"}</p></div><figure><figcaption>BEFORE</figcaption><DocumentPreview document={session.pendingPatch.before} /></figure><div className="patch-arrow"><TbChevronRight /></div><figure><figcaption>AFTER</figcaption><DocumentPreview document={session.pendingPatch.after} /></figure><div className="patch-actions"><Button variant="outline" onClick={() => session.decidePatch(session.pendingPatch!.patch.id, "reject")}>REJECT</Button><Button variant="accent" onClick={() => session.decidePatch(session.pendingPatch!.patch.id, "apply")}>APPLY PATCH</Button></div></section>}
    </main>
  );
}

function SequenceImportDialog({ files, onMove, onCancel, onSequence, onSeparate }: {
  files: File[];
  onMove: (index: number, direction: -1 | 1) => void;
  onCancel: () => void;
  onSequence: () => void;
  onSeparate: () => void;
}) {
  return (
    <div className="import-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <header>
          <span><b id="import-dialog-title">Import {files.length} images</b><small>They look like a frame sequence. Check the order before importing.</small></span>
          <Button size="icon" variant="ghost" aria-label="Cancel import" onClick={onCancel}><TbX /></Button>
        </header>
        <ol className="import-frame-list" aria-label="Frame order">
          {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
            <FileThumbnail file={file} />
            <span><b>Frame {index + 1}</b><small title={file.name}>{file.name}</small></span>
            <div>
              <Button size="icon" variant="ghost" aria-label={`Move ${file.name} earlier`} disabled={index === 0} onClick={() => onMove(index, -1)}><TbArrowLeft /></Button>
              <Button size="icon" variant="ghost" aria-label={`Move ${file.name} later`} disabled={index === files.length - 1} onClick={() => onMove(index, 1)}><TbArrowRight /></Button>
            </div>
          </li>)}
        </ol>
        <div className="import-dialog-actions">
          <Button variant="outline" onClick={onSeparate}>Import as {files.length} images</Button>
          <Button onClick={onSequence}><TbPlayerPlay />Import as animation · {files.length} frames</Button>
        </div>
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

function SessionStatus({ sessionId, status, host, clients, revision, workingChanged, selection, hasPendingPatch }: {
  sessionId?: string;
  status: ConnectionStatus;
  host?: "browser" | "codex" | "claude";
  clients: string[];
  revision: number;
  workingChanged: boolean;
  selection?: Selection;
  hasPendingPatch: boolean;
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
            <i className={workingChanged ? "unsaved" : "saved"}>{workingChanged ? "Unsaved" : "Saved"}</i>
          </header>
          <dl className="session-meta">
            <div><dt>Host</dt><dd>{hostLabel ?? "None"}</dd></div>
            <div><dt>Clients</dt><dd className="session-clients">{clients.length > 0 ? clientLabels(clients).join(" · ") : "None"}</dd></div>
            <div><dt>Revision</dt><dd>{revision}</dd></div>
          </dl>
          <section className="agent-workflow">
            <h2>Agent workflow</h2>
            <ol>
              <li><i>1</i><span><b>Select an area</b><small>{selectionLabel}</small></span></li>
              <li><i>2</i><span><b>Ask Codex or Claude</b><small>Describe the pixel change</small></span></li>
              <li><i>3</i><span><b>Review the patch</b><small>{hasPendingPatch ? "Patch ready to review" : "Apply or reject before editing"}</small></span></li>
            </ol>
          </section>
          <p className="agent-safety">The revision and selection must match. Pixels outside the selection stay unchanged, and every patch requires review.</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function IconButton({ label, icon: Icon, active = false, ...props }: { label: string; icon: IconType; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button size="icon" variant="ghost" aria-label={label} title={label} className={active ? "active" : ""} {...props}><Icon /></Button>;
}

function ExportPopover({ document, frameId }: { document: PixelDocument; frameId: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"png" | "json">("png");
  const [scale, setScale] = useState(1);
  const scales = [1, 2, 4, 8];
  const exportCurrent = async () => {
    if (format === "json") downloadDocument(document);
    else await downloadPng(document, { frameId, scale });
    setOpen(false);
  };
  const exportMore = async (kind: "layers" | "frames" | "sprite") => {
    if (kind === "layers") await downloadLayerPngs(document, frameId, scale);
    else if (kind === "frames") await downloadFramePngs(document, scale);
    else await downloadSpriteSheet(document, scale);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="header-export-trigger" aria-label="Export" title="Export"><TbDownload /></PopoverTrigger>
      <PopoverContent className="export-popover" side="bottom" align="end" sideOffset={8}>
        <header><b>Export</b><small>Download the current pixel document</small></header>
        <section className="export-section">
          <span className="export-label">Format</span>
          <div className="export-format" role="group" aria-label="Export format">
            <button type="button" aria-pressed={format === "png"} className={format === "png" ? "active" : ""} onClick={() => setFormat("png")}><TbFileTypePng />PNG</button>
            <button type="button" aria-pressed={format === "json"} className={format === "json" ? "active" : ""} onClick={() => setFormat("json")}><TbJson />Pixel JSON</button>
          </div>
        </section>
        {format === "png" && <>
          <section className="export-section">
            <span className="export-label">Scale</span>
            <div className="export-scale" role="group" aria-label="PNG scale">
              {scales.map((value) => <button type="button" key={value} aria-pressed={scale === value} className={scale === value ? "active" : ""} onClick={() => setScale(value)}>{value}×</button>)}
            </div>
            <output className="export-size">{document.canvas.width} × {document.canvas.height}<span>→</span><b>{document.canvas.width * scale} × {document.canvas.height * scale}</b></output>
          </section>
        </>}
        <Button className="export-submit" onClick={() => void exportCurrent()}>{format === "png" ? <TbFileTypePng /> : <TbJson />}Export {format === "png" ? "PNG" : "Pixel JSON"}</Button>
        {format === "png" && <details className="export-more">
          <summary>More exports <TbChevronRight /></summary>
          <div>
            <Button variant="ghost" size="sm" onClick={() => void exportMore("layers")}><TbStack />All layers</Button>
            <Button variant="ghost" size="sm" onClick={() => void exportMore("frames")}><TbPlayerPlay />All frames</Button>
            <Button variant="ghost" size="sm" onClick={() => void exportMore("sprite")}><TbGridDots />Sprite sheet</Button>
          </div>
        </details>}
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

function FramesList({ document, activeFrameId, keyboardTarget, onSelect, onReorder, onDuration }: {
  document: PixelDocument;
  activeFrameId: string;
  keyboardTarget: boolean;
  onSelect: (frameId: string) => void;
  onReorder: (frameId: string, toIndex: number) => void;
  onDuration: (frameId: string, durationMs: number) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const targetIndex = document.frames.findIndex((frame) => frame.id === over.id);
    if (targetIndex >= 0) onReorder(String(active.id), targetIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => onSelect(String(active.id))}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={document.frames.map((frame) => frame.id)} strategy={verticalListSortingStrategy}>
        <div className="frame-stack-list">
          {document.frames.map((frame, index) => (
            <SortableFrameRow
              key={frame.id}
              document={document}
              frame={frame}
              label={`Frame ${index + 1}`}
              active={activeFrameId === frame.id}
              keyboardTarget={keyboardTarget && activeFrameId === frame.id}
              canReorder={document.frames.length > 1}
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
      </div>
      <label className="frame-duration">
        <BlurNumberInput ariaLabel={`${label} duration`} min={1} max={60000} value={frame.durationMs} onCommit={onDuration} />
        <span aria-hidden="true">ms</span>
      </label>
    </div>
  );
}

function InspectorSection({ icon: Icon, title, count, action, children }: { icon: IconType; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="inspector-section"><header><Icon /><h2>{title}</h2>{count !== undefined && <span className="inspector-section-count" aria-label={`${count} frame${count === 1 ? "" : "s"}`}>{count}</span>}{action}</header><div className="inspector-section-body">{children}</div></section>;
}
function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <div className="control-field"><span className="control-field-label">{label}{help && <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><button type="button" className="field-help" aria-label={`About ${label}`}><TbQuestionMark /></button></TooltipTrigger><TooltipContent className="field-help-tooltip">{help}</TooltipContent></Tooltip></TooltipProvider>}</span>{children}</div>;
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

function sourceFramesFor(source: SourceAsset): SourceFrameAsset[] {
  if (source.sourceFrames) return source.sourceFrames;
  if (!source.sourceBlob) return [];
  return [{
    frameId: source.variants[0]?.document.frames[0]?.id ?? "frame-1",
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

function createSource(file: File, document: PixelDocument, settings: ConvertSettings): SourceAsset {
  const variant: Variant = { id: crypto.randomUUID(), name: "V1", document, appliedSettings: cloneSettings(settings), hasEditsSinceConversion: false, createdAt: new Date().toISOString() };
  const isImage = file.type.startsWith("image/");
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type,
    ...(isImage ? { sourceFrames: [createSourceFrame(file, document.frames[0]!.id)] } : {}),
    variants: [variant]
  };
}

function createSequenceSource(files: File[], document: PixelDocument, settings: ConvertSettings): SourceAsset {
  const variant: Variant = { id: crypto.randomUUID(), name: "V1", document, appliedSettings: cloneSettings(settings), hasEditsSinceConversion: false, createdAt: new Date().toISOString() };
  return {
    id: crypto.randomUUID(),
    name: sequenceSourceName(files),
    mimeType: "application/x-image-sequence",
    sourceFrames: files.map((file, index) => createSourceFrame(file, document.frames[index]!.id)),
    variants: [variant]
  };
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
  next.frames = documents.map((document, index) => ({
    id: ids[index]!,
    name: `Frame ${index + 1}`,
    durationMs: existingFramesById.get(ids[index]!)?.durationMs ?? document.frames[0]?.durationMs ?? 100
  }));
  next.layers = first.layers.map((layer, layerIndex) => ({
    ...structuredClone(layer),
    frames: Object.fromEntries(documents.map((document, index) => {
      const sourceLayer = document.layers[layerIndex] ?? document.layers[0]!;
      const sourceFrameId = document.frames[0]!.id;
      return [ids[index]!, remapPixels(sourceLayer.frames[sourceFrameId]!, document.palette, next.palette, next.transparentColorIndex)];
    }))
  }));
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

function appendFrameDocuments(document: PixelDocument, frames: PixelDocument[], frameIds: string[]): PixelDocument {
  const next = structuredClone(document);
  const pixelCount = next.canvas.width * next.canvas.height;
  frames.forEach((frameDocument, index) => {
    const frameId = frameIds[index]!;
    next.frames.push({ id: frameId, name: `Frame ${next.frames.length + 1}`, durationMs: frameDocument.frames[0]?.durationMs ?? 100 });
    for (const layer of next.layers) layer.frames[frameId] = new Array<number>(pixelCount).fill(next.transparentColorIndex);
    const targetLayer = next.layers[0]!;
    const sourceLayer = frameDocument.layers[0]!;
    targetLayer.frames[frameId] = remapPixels(
      sourceLayer.frames[frameDocument.frames[0]!.id]!,
      frameDocument.palette,
      next.palette,
      next.transparentColorIndex
    );
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
