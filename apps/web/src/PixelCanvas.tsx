import {
  fillNormal,
  erasePixel,
  fill,
  resetNormalPixel,
  setPixel,
  setNormalPixel,
  type Patch
} from "@editable-pixel/core";
import type { PixelDocument, Selection } from "@editable-pixel/document";
import {
  renderLitRgba,
  renderNormalRgba,
  renderRgba,
  type LightSettings
} from "@editable-pixel/renderer";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";

export type Tool = "pen" | "eraser" | "fill" | "select";
export type EditMapMode = "color" | "normal";
export type NormalPreviewMode = "map" | "lit";
export type GridMode = "square" | "isometric";

export interface OnionSkinSettings {
  previous: number;
  next: number;
  opacity: number;
  frameIds?: string[];
}

interface PixelCanvasProps {
  document: PixelDocument;
  layerId: string;
  frameId: string;
  tool: Tool;
  colorIndex: number;
  editMap: EditMapMode;
  normalValue: number;
  normalPreview: NormalPreviewMode;
  light: LightSettings;
  showLightMarker: boolean;
  zoom: number;
  showGrid: boolean;
  gridMode: GridMode;
  onionSkin: OnionSkinSettings;
  canvasBackground: string;
  referenceImageUrl?: string;
  compareMode: boolean;
  colorPickMode: boolean;
  keyboardTarget: boolean;
  fitRequest: number;
  selectionFitRequest: number;
  onFitZoom: (zoom: number) => void;
  onZoom: (zoom: number) => void;
  onActivate: () => void;
  onEdit: (operation: (document: PixelDocument) => Patch) => void;
  onSelection: (selection: Selection | undefined) => void;
  onPickColor: (color: string) => void;
  onLightPosition: (x: number, y: number) => void;
  onLightCommit: (x: number, y: number) => void;
}

interface Point { x: number; y: number }
type RectSelection = Extract<Selection, { type: "rect" }>;

const previousFrameTint: [number, number, number] = [255, 92, 53];
const nextFrameTint: [number, number, number] = [42, 211, 235];
const isometricTileHeight = 8;

export function isometricGridPath(width: number, height: number, major: boolean): string {
  const commands: string[] = [];
  for (const slope of [0.5, -0.5]) {
    const minimumIntercept = slope > 0 ? -slope * width : 0;
    const maximumIntercept = slope > 0 ? height : height - slope * width;
    const first = Math.floor(minimumIntercept / isometricTileHeight);
    const last = Math.ceil(maximumIntercept / isometricTileHeight);
    for (let index = first; index <= last; index += 1) {
      if ((index % 4 === 0) !== major) continue;
      const intercept = index * isometricTileHeight;
      commands.push(`M 0 ${intercept} L ${width} ${slope * width + intercept}`);
    }
  }
  return commands.join(" ");
}

export function renderOnionSkinRgba(
  document: PixelDocument,
  frameId: string,
  settings: OnionSkinSettings
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(document.canvas.width * document.canvas.height * 4);
  const frames = settings.frameIds
    ? settings.frameIds
      .map((candidateId) => document.frames.find((frame) => frame.id === candidateId))
      .filter((frame): frame is PixelDocument["frames"][number] => Boolean(frame))
    : document.frames;
  if (frames.length < 2 || (settings.previous <= 0 && settings.next <= 0)) return pixels;

  const activeIndex = frames.findIndex((frame) => frame.id === frameId);
  if (activeIndex < 0) return pixels;

  const baseOpacity = Math.min(1, Math.max(0, settings.opacity));
  const previousCount = Math.max(0, Math.floor(settings.previous));
  const nextCount = Math.max(0, Math.floor(settings.next));

  const compositeFrames = (
    direction: -1 | 1,
    count: number,
    tint: [number, number, number]
  ) => {
    for (let distance = count; distance >= 1; distance -= 1) {
      const frame = frames[activeIndex + direction * distance];
      if (!frame) continue;
      const distanceOpacity = baseOpacity * Math.max(0.35, 1 - (distance - 1) * 0.25);
      compositeRgba(pixels, renderRgba(document, { frameId: frame.id }).data, distanceOpacity, tint);
    }
  };

  compositeFrames(-1, previousCount, previousFrameTint);
  compositeFrames(1, nextCount, nextFrameTint);
  return pixels;
}

function compositeRgba(
  target: Uint8ClampedArray,
  source: Uint8ClampedArray,
  opacity = 1,
  tint?: [number, number, number]
): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const sourceAlpha = (source[offset + 3]! / 255) * opacity;
    if (sourceAlpha === 0) continue;
    const targetAlpha = target[offset + 3]! / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

    for (let channel = 0; channel < 3; channel += 1) {
      const sourceColor = tint?.[channel] ?? source[offset + channel]!;
      target[offset + channel] = Math.round(
        (sourceColor * sourceAlpha + target[offset + channel]! * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha
      );
    }
    target[offset + 3] = Math.round(outputAlpha * 255);
  }
}

export function PixelCanvas({
  document,
  layerId,
  frameId,
  tool,
  colorIndex,
  editMap,
  normalValue,
  normalPreview,
  light,
  showLightMarker,
  zoom,
  showGrid,
  gridMode,
  onionSkin,
  canvasBackground,
  referenceImageUrl,
  compareMode,
  colorPickMode,
  keyboardTarget,
  fitRequest,
  selectionFitRequest,
  onFitZoom,
  onZoom,
  onActivate,
  onEdit,
  onSelection,
  onPickColor,
  onLightPosition,
  onLightCommit
}: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousSelectionFitRequest = useRef(selectionFitRequest);
  const spacePressed = useRef(false);
  const zPressed = useRef(false);
  const additiveSelection = useRef(false);
  const [start, setStart] = useState<Point>();
  const [dragSelection, setDragSelection] = useState<RectSelection>();
  const [zoomStart, setZoomStart] = useState<Point>();
  const [dragZoomArea, setDragZoomArea] = useState<RectSelection>();
  const [panStart, setPanStart] = useState<{ point: Point; left: number; top: number }>();
  const [navigationCursor, setNavigationCursor] = useState(false);
  const [zoomAreaCursor, setZoomAreaCursor] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  const [compareDragging, setCompareDragging] = useState(false);
  const lightDraggingRef = useRef(false);
  const lightPositionRef = useRef({ x: light.x, y: light.y });
  const selection = dragSelection
    ? additiveSelection.current
      ? addOrToggleSelection(document.selection, dragSelection, document.canvas.width)
      : dragSelection
    : document.selection;

  useEffect(() => setComparePosition(50), [referenceImageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const rendered = editMap === "normal"
      ? normalPreview === "lit"
        ? renderLitRgba(document, light, { frameId })
        : renderNormalRgba(document, { frameId })
      : renderRgba(document, { frameId });
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const pixels = editMap === "color"
      ? renderOnionSkinRgba(document, frameId, onionSkin)
      : new Uint8ClampedArray(rendered.data.length);
    compositeRgba(pixels, rendered.data);
    const imagePixels = new Uint8ClampedArray(pixels.length);
    imagePixels.set(pixels);
    canvas.getContext("2d")!.putImageData(new ImageData(imagePixels, rendered.width, rendered.height), 0, 0);
  }, [document, editMap, frameId, light, normalPreview, onionSkin]);

  useEffect(() => {
    const canvas = selectionMaskCanvasRef.current;
    if (!canvas || selection?.type !== "mask") return;
    const { width, height } = document.canvas;
    canvas.width = width;
    canvas.height = height;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const selected = new Set(selection.indices);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      if (selected.has(index)) {
        pixels[offset + 3] = 0;
      } else {
        pixels[offset] = 8;
        pixels[offset + 1] = 10;
        pixels[offset + 2] = 8;
        pixels[offset + 3] = 56;
      }
    }
    canvas.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [document.canvas, selection]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 96);
    const availableHeight = Math.max(1, viewport.clientHeight - 128);
    const fitted = Math.floor(Math.min(
      availableWidth / document.canvas.width,
      availableHeight / document.canvas.height
    ));
    onFitZoom(Math.max(1, Math.min(48, fitted)));
  }, [document.canvas.height, document.canvas.width, fitRequest, onFitZoom]);

  useEffect(() => {
    if (selectionFitRequest === previousSelectionFitRequest.current) return;
    previousSelectionFitRequest.current = selectionFitRequest;
    const viewport = viewportRef.current;
    const selection = document.selection;
    if (!viewport || !selection) return;
    const fitted = Math.floor(Math.min(
      Math.max(1, viewport.clientWidth - 96) / selection.width,
      Math.max(1, viewport.clientHeight - 128) / selection.height
    ));
    onFitZoom(Math.max(1, Math.min(48, fitted)));
    requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) return;
      const targetX = (selection.x + selection.width / 2) * fitted;
      const targetY = (selection.y + selection.height / 2) * fitted;
      viewport.scrollLeft = Math.max(0, shell.offsetLeft + targetX - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, shell.offsetTop + targetY - viewport.clientHeight / 2);
    });
  }, [document.selection, onFitZoom, selectionFitRequest]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof Element && target.matches("input, select, textarea, [contenteditable='true']")) return;
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        spacePressed.current = true;
        setNavigationCursor(true);
      } else if (event.code === "KeyZ" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        zPressed.current = true;
        setZoomAreaCursor(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spacePressed.current = false;
        setNavigationCursor(false);
      } else if (event.code === "KeyZ") {
        zPressed.current = false;
        setZoomAreaCursor(false);
      }
    };
    const blur = () => {
      spacePressed.current = false;
      zPressed.current = false;
      setNavigationCursor(false);
      setZoomAreaCursor(false);
    };
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
    const viewport = viewportRef.current;
    if (!viewport) return;

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const shell = shellRef.current;
        if (!shell) return;
        const before = shell.getBoundingClientRect();
        const worldX = (event.clientX - before.left) / zoom;
        const worldY = (event.clientY - before.top) / zoom;
        const next = Math.max(1, Math.min(48, zoom + (event.deltaY < 0 ? 1 : -1)));
        if (next === zoom) return;
        const clientX = event.clientX;
        const clientY = event.clientY;
        onZoom(next);
        requestAnimationFrame(() => {
          const after = shell.getBoundingClientRect();
          viewport.scrollLeft += after.left + worldX * next - clientX;
          viewport.scrollTop += after.top + worldY * next - clientY;
        });
        return;
      }
      if (event.shiftKey) viewport.scrollLeft += event.deltaY || event.deltaX;
      else {
        viewport.scrollLeft += event.deltaX;
        viewport.scrollTop += event.deltaY;
      }
    };

    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [onZoom, zoom]);

  const pointFor = (event: ReactPointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(document.canvas.width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * document.canvas.width))),
      y: Math.max(0, Math.min(document.canvas.height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * document.canvas.height)))
    };
  };

  const editPoint = (point: Point) => {
    if (editMap === "normal") {
      if (tool === "pen") onEdit((current) => setNormalPixel(current, layerId, frameId, point.x, point.y, normalValue, current.selection));
      if (tool === "eraser") onEdit((current) => resetNormalPixel(current, layerId, frameId, point.x, point.y, current.selection));
      if (tool === "fill") onEdit((current) => fillNormal(current, layerId, frameId, point.x, point.y, normalValue, current.selection));
      return;
    }
    if (tool === "pen") onEdit((current) => setPixel(current, layerId, frameId, point.x, point.y, colorIndex, current.selection));
    if (tool === "eraser") onEdit((current) => erasePixel(current, layerId, frameId, point.x, point.y, current.selection));
    if (tool === "fill") onEdit((current) => fill(current, layerId, frameId, point.x, point.y, colorIndex, current.selection));
  };

  const updateLightPosition = (clientX: number, clientY: number): Point | undefined => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const point = {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
    lightPositionRef.current = point;
    onLightPosition(point.x, point.y);
    return point;
  };

  const onLightPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    lightDraggingRef.current = true;
    updateLightPosition(event.clientX, event.clientY);
  };

  const onLightPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!lightDraggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    updateLightPosition(event.clientX, event.clientY);
  };

  const onLightPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    lightDraggingRef.current = false;
    onLightCommit(lightPositionRef.current.x, lightPositionRef.current.y);
  };

  const pickColor = (point: Point) => {
    const data = canvasRef.current?.getContext("2d")?.getImageData(point.x, point.y, 1, 1).data;
    if (!data) return;
    const color = `#${[data[0], data[1], data[2], data[3]].map((channel) => channel!.toString(16).padStart(2, "0")).join("")}`;
    onPickColor(color);
  };

  const updateComparePosition = (clientX: number) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    setComparePosition(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  };

  const onComparePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCompareDragging(true);
    updateComparePosition(event.clientX);
  };

  const onComparePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!compareDragging) return;
    event.preventDefault();
    event.stopPropagation();
    updateComparePosition(event.clientX);
  };

  const onComparePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCompareDragging(false);
  };

  const onCompareKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setComparePosition((current) => Math.max(0, Math.min(100, current + (event.key === "ArrowLeft" ? -5 : 5))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setComparePosition(event.key === "Home" ? 0 : 100);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 1 || spacePressed.current) {
      event.preventDefault();
      const viewport = viewportRef.current!;
      setPanStart({ point: { x: event.clientX, y: event.clientY }, left: viewport.scrollLeft, top: viewport.scrollTop });
      setNavigationCursor(true);
      return;
    }
    const point = pointFor(event);
    if (event.button === 0 && colorPickMode) {
      event.preventDefault();
      pickColor(point);
      return;
    }
    if (event.button === 0 && zPressed.current) {
      event.preventDefault();
      setZoomStart(point);
      setDragZoomArea({ type: "rect", ...point, width: 1, height: 1, layerId, frameId });
      return;
    }
    if (compareMode) {
      event.preventDefault();
      return;
    }
    setStart(point);
    if (tool === "select") {
      additiveSelection.current = event.shiftKey;
      setDragSelection({ type: "rect", ...point, width: 1, height: 1, layerId, frameId });
    } else {
      editPoint(point);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lightDraggingRef.current) {
      updateLightPosition(event.clientX, event.clientY);
      return;
    }
    if (panStart) {
      const viewport = viewportRef.current!;
      viewport.scrollLeft = panStart.left - (event.clientX - panStart.point.x);
      viewport.scrollTop = panStart.top - (event.clientY - panStart.point.y);
      return;
    }
    if (zoomStart) {
      const point = pointFor(event);
      setDragZoomArea({
        type: "rect",
        x: Math.min(zoomStart.x, point.x),
        y: Math.min(zoomStart.y, point.y),
        width: Math.abs(zoomStart.x - point.x) + 1,
        height: Math.abs(zoomStart.y - point.y) + 1,
        layerId,
        frameId
      });
      return;
    }
    if (!start) return;
    const point = pointFor(event);
    if (tool === "select") {
      setDragSelection({
        type: "rect",
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(start.x - point.x) + 1,
        height: Math.abs(start.y - point.y) + 1,
        layerId,
        frameId
      });
    } else if (tool === "pen" || tool === "eraser") {
      editPoint(point);
    }
  };

  const onPointerUp = () => {
    if (lightDraggingRef.current) {
      lightDraggingRef.current = false;
      return;
    }
    if (panStart) {
      setPanStart(undefined);
      setNavigationCursor(spacePressed.current);
      return;
    }
    if (zoomStart) {
      const area = dragZoomArea;
      setZoomStart(undefined);
      setDragZoomArea(undefined);
      if (!area || (area.width === 1 && area.height === 1)) return;
      const viewport = viewportRef.current!;
      const fitted = Math.max(1, Math.min(48, Math.floor(Math.min(
        Math.max(1, viewport.clientWidth - 96) / area.width,
        Math.max(1, viewport.clientHeight - 128) / area.height
      ))));
      onZoom(fitted);
      requestAnimationFrame(() => {
        const shell = shellRef.current;
        if (!shell) return;
        const targetX = (area.x + area.width / 2) * fitted;
        const targetY = (area.y + area.height / 2) * fitted;
        viewport.scrollLeft = Math.max(0, shell.offsetLeft + targetX - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, shell.offsetTop + targetY - viewport.clientHeight / 2);
      });
      return;
    }
    if (tool === "select" && dragSelection) {
      onSelection(additiveSelection.current
        ? addOrToggleSelection(document.selection, dragSelection, document.canvas.width)
        : dragSelection);
    }
    additiveSelection.current = false;
    setStart(undefined);
    setDragSelection(undefined);
  };

  const onPointerCancel = () => {
    lightDraggingRef.current = false;
    setPanStart(undefined);
    setStart(undefined);
    setDragSelection(undefined);
    setZoomStart(undefined);
    setDragZoomArea(undefined);
    additiveSelection.current = false;
    setNavigationCursor(spacePressed.current);
  };

  return (
    <div className="canvas-viewport" ref={viewportRef}>
      <div className="canvas-stage" style={{ minWidth: document.canvas.width * zoom + 96, minHeight: document.canvas.height * zoom + 128 }}>
        <div
          ref={shellRef}
          className={`pixel-canvas-shell tool-${tool} map-${editMap}${keyboardTarget ? " keyboard-target" : ""}${navigationCursor ? " navigation-cursor" : ""}${zoomAreaCursor ? " zoom-area-cursor" : ""}${compareMode ? " compare-mode" : ""}${colorPickMode ? " color-pick-cursor" : ""}`}
          style={{
            width: document.canvas.width * zoom,
            height: document.canvas.height * zoom,
            backgroundColor: canvasBackground,
            backgroundImage: "none"
          }}
          onPointerDown={(event) => { onActivate(); onPointerDown(event); }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} aria-label="Pixel canvas" />
          {showGrid && gridMode === "square" && <div className="pixel-grid pixel-grid-square" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />}
          {showGrid && gridMode === "isometric" && (
            <svg
              className="pixel-grid pixel-grid-isometric"
              viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
              preserveAspectRatio="none"
              aria-label="2 to 1 isometric guide"
            >
              <path className="isometric-grid-minor" d={isometricGridPath(document.canvas.width, document.canvas.height, false)} />
              <path className="isometric-grid-major" d={isometricGridPath(document.canvas.width, document.canvas.height, true)} />
            </svg>
          )}
          {compareMode && referenceImageUrl && (
            <div
              className="reference-overlay"
              aria-hidden="true"
              style={{ clipPath: `inset(0 ${100 - comparePosition}% 0 0)` }}
            >
              <img
                src={referenceImageUrl}
                alt=""
                style={{
                  left: document.contentBox.x * zoom,
                  top: document.contentBox.y * zoom,
                  width: document.contentBox.width * zoom,
                  height: document.contentBox.height * zoom,
                  objectPosition: document.alignment === "bottom-center" ? "center bottom" : "center center"
                }}
              />
            </div>
          )}
          {editMap === "normal" && normalPreview === "lit" && showLightMarker && (
            <button
              type="button"
              className="normal-light-handle"
              aria-label="Move light"
              title="Drag light"
              style={{ left: `${light.x * 100}%`, top: `${light.y * 100}%` }}
              onPointerDown={onLightPointerDown}
              onPointerMove={onLightPointerMove}
              onPointerUp={onLightPointerUp}
              onPointerCancel={onLightPointerUp}
            ><span /></button>
          )}
          <div
            className="content-frame-guide"
            aria-label={`Content frame ${document.contentBox.width} by ${document.contentBox.height}`}
            style={{
              left: document.contentBox.x * zoom,
              top: document.contentBox.y * zoom,
              width: document.contentBox.width * zoom,
              height: document.contentBox.height * zoom
            }}
          ><span>Content Frame</span></div>
          {selection?.type === "rect" && (
            <>
              <div className="selection-shade" aria-hidden="true" style={{ inset: `0 0 auto 0`, height: selection.y * zoom }} />
              <div className="selection-shade" aria-hidden="true" style={{ left: 0, top: selection.y * zoom, width: selection.x * zoom, height: selection.height * zoom }} />
              <div className="selection-shade" aria-hidden="true" style={{ left: (selection.x + selection.width) * zoom, right: 0, top: selection.y * zoom, height: selection.height * zoom }} />
              <div className="selection-shade" aria-hidden="true" style={{ inset: `${(selection.y + selection.height) * zoom}px 0 0 0` }} />
              <div
                className="selection-box"
                style={{
                  left: selection.x * zoom,
                  top: selection.y * zoom,
                  width: selection.width * zoom,
                  height: selection.height * zoom
                }}
              />
            </>
          )}
          {selection?.type === "mask" && (
            <>
              <canvas ref={selectionMaskCanvasRef} className="selection-mask-overlay" style={{ width: "100%", height: "100%" }} aria-label={`${selection.indices.length} selected pixels`} />
              <svg className="selection-mask-outline" viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`} preserveAspectRatio="none" aria-hidden="true">
                <path d={selectionMaskOutline(selection.indices, document.canvas.width)} />
              </svg>
            </>
          )}
          {dragZoomArea && (
            <div
              className="zoom-area-box"
              aria-label="Zoom area"
              style={{
                left: dragZoomArea.x * zoom,
                top: dragZoomArea.y * zoom,
                width: dragZoomArea.width * zoom,
                height: dragZoomArea.height * zoom
              }}
            />
          )}
          {compareMode && referenceImageUrl && (
            <>
              <span className="compare-label compare-label-original">Original</span>
              <span className="compare-label compare-label-pixel">Pixel</span>
              <div
                className="compare-divider"
                role="slider"
                tabIndex={0}
                aria-label="Original comparison"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(comparePosition)}
                style={{ left: `${comparePosition}%` }}
                onPointerDown={onComparePointerDown}
                onPointerMove={onComparePointerMove}
                onPointerUp={onComparePointerUp}
                onPointerCancel={onComparePointerUp}
                onKeyDown={onCompareKeyDown}
              ><i /></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function selectionMaskOutline(indices: readonly number[], canvasWidth: number): string {
  const selected = new Set(indices);
  const edges: string[] = [];
  for (const index of indices) {
    const x = index % canvasWidth;
    const y = Math.floor(index / canvasWidth);
    if (y === 0 || !selected.has(index - canvasWidth)) edges.push(`M${x} ${y}H${x + 1}`);
    if (x === canvasWidth - 1 || !selected.has(index + 1)) edges.push(`M${x + 1} ${y}V${y + 1}`);
    if (!selected.has(index + canvasWidth)) edges.push(`M${x + 1} ${y + 1}H${x}`);
    if (x === 0 || !selected.has(index - 1)) edges.push(`M${x} ${y + 1}V${y}`);
  }
  return edges.join("");
}

function addOrToggleSelection(
  current: Selection | undefined,
  candidate: RectSelection,
  canvasWidth: number
): Selection | undefined {
  if (!current || current.layerId !== candidate.layerId || current.frameId !== candidate.frameId) return candidate;
  const selected = new Set(selectionIndices(current, canvasWidth));
  const candidateIndices = selectionIndices(candidate, canvasWidth);
  if (candidate.width === 1 && candidate.height === 1) {
    const [index] = candidateIndices;
    if (index === undefined) return current;
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
  } else {
    for (const index of candidateIndices) selected.add(index);
  }
  return selectionFromIndices([...selected].sort((left, right) => left - right), candidate, canvasWidth);
}

function selectionIndices(selection: Selection, canvasWidth: number): number[] {
  if (selection.type === "mask") return [...selection.indices];
  const indices: number[] = [];
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      indices.push(y * canvasWidth + x);
    }
  }
  return indices;
}

function selectionFromIndices(
  indices: number[],
  target: Pick<Selection, "layerId" | "frameId">,
  canvasWidth: number
): Selection | undefined {
  if (indices.length === 0) return undefined;
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
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return indices.length === bounds.width * bounds.height
    ? { type: "rect", ...bounds, layerId: target.layerId, frameId: target.frameId }
    : { type: "mask", ...bounds, layerId: target.layerId, frameId: target.frameId, indices };
}
