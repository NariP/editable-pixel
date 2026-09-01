import {
  addFrame,
  addLayer,
  addPaletteColor,
  clearNormalSelection,
  clearSelection,
  createNormalPixelPatch,
  createPixelPatch,
  duplicateFrame,
  duplicateLayer,
  flipSelection,
  getNormalPixels,
  getPixels,
  mergePaletteColors,
  moveSelection,
  removeFrame,
  removeFrameLightingKeyframe,
  removeLayer,
  removePaletteColor,
  renameFrame,
  renameLayer,
  reorderFrame,
  reorderLayer,
  reorderPaletteColor,
  replaceColor,
  setFrameDuration,
  setFrameLighting,
  setFrameLightingInterpolation,
  setLayerOpacity,
  setLayerVisibility,
  type Patch
} from "@editable-pixel/core";
import {
  DEFAULT_FRAME_LIGHTING,
  type FrameLighting,
  type FrameLightingInterpolation,
  type PixelDocument,
  type Selection
} from "@editable-pixel/document";
import { assertPixelProject, type PixelProject } from "@editable-pixel/project";

export type EditActor = "user" | "ai" | "system";

export type EditablePixelAction =
  | {
    type: "paint_pixels";
    pixels: Array<{ x: number; y: number; colorIndex: number }>;
    layerId?: string;
    frameId?: string;
    requireSelection?: boolean;
  }
  | { type: "paint_selection"; colorIndex: number }
  | { type: "erase_selection" }
  | { type: "replace_color"; fromColorIndex: number; toColorIndex: number; selectionOnly?: boolean }
  | { type: "move_selection"; dx: number; dy: number }
  | { type: "flip_selection"; axis: "horizontal" | "vertical" }
  | {
    type: "paint_normals";
    pixels: Array<{ x: number; y: number; normal: number }>;
    layerId?: string;
    frameId?: string;
    requireSelection?: boolean;
  }
  | { type: "reset_selection_normals" }
  | { type: "add_palette_color"; color: string }
  | { type: "remove_palette_color"; colorIndex: number; replacementIndex: number }
  | { type: "replace_palette_color"; fromColorIndex: number; toColorIndex: number }
  | { type: "reorder_palette_color"; fromIndex: number; toIndex: number }
  | { type: "add_layer"; name: string }
  | { type: "remove_layer"; layerId: string }
  | { type: "duplicate_layer"; layerId: string }
  | { type: "rename_layer"; layerId: string; name: string }
  | { type: "reorder_layer"; layerId: string; toIndex: number }
  | { type: "set_layer_visibility"; layerId: string; visible: boolean }
  | { type: "set_layer_opacity"; layerId: string; opacity: number }
  | { type: "add_frame"; name?: string; durationMs?: number }
  | { type: "remove_frame"; frameId: string }
  | { type: "duplicate_frame"; frameId: string }
  | { type: "rename_frame"; frameId: string; name: string }
  | { type: "reorder_frame"; frameId: string; toIndex: number }
  | { type: "set_frame_duration"; frameId: string; durationMs: number }
  | { type: "set_frame_lighting"; frameId: string; lighting: FrameLighting }
  | { type: "set_lighting_interpolation"; frameId: string; interpolation: FrameLightingInterpolation }
  | { type: "remove_lighting_keyframe"; frameId: string }
  | { type: "create_clip"; name: string; frameIds: string[] }
  | { type: "remove_clip"; clipId: string }
  | { type: "rename_clip"; clipId: string; name: string }
  | { type: "set_clip_frames"; clipId: string; frameIds: string[] }
  | { type: "reorder_clip"; clipId: string; toIndex: number }
  | { type: "rename_project"; name: string };

export type SelectionCommand =
  | {
    type: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | {
    type: "pixels";
    pixels: Array<{ x: number; y: number }>;
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | {
    type: "color";
    colorIndex: number;
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | {
    type: "connected";
    x: number;
    y: number;
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | {
    type: "outline";
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | {
    type: "content_bounds";
    layerId?: string;
    frameId?: string;
    mode?: "replace" | "add" | "remove" | "toggle";
  }
  | { type: "clear" };

export function createActionPatch(
  document: PixelDocument,
  action: EditablePixelAction,
  reason: string,
  fallback?: { layerId: string; frameId: string }
): Patch {
  const selection = document.selection;
  const target = targetIds(document, action, fallback);
  switch (action.type) {
    case "paint_pixels": {
      const bounded = action.requireSelection ?? Boolean(selection);
      const activeSelection = bounded ? requireSelection(document) : undefined;
      const pixels = getPixels(document, target.layerId, target.frameId);
      const changes = action.pixels.map(({ x, y, colorIndex }) => {
        const index = pixelIndex(document, x, y);
        return { index, before: pixels[index]!, after: colorIndex };
      });
      return createPixelPatch(document, target.layerId, target.frameId, changes, activeSelection, reason);
    }
    case "paint_selection": {
      const activeSelection = requireSelection(document);
      const pixels = getPixels(document, activeSelection.layerId, activeSelection.frameId);
      return createPixelPatch(
        document,
        activeSelection.layerId,
        activeSelection.frameId,
        selectionIndices(activeSelection, document.canvas.width).map((index) => ({
          index,
          before: pixels[index]!,
          after: action.colorIndex
        })),
        activeSelection,
        reason
      );
    }
    case "erase_selection":
      return withReason(clearSelection(document, requireSelection(document)), reason);
    case "replace_color":
      return withReason(replaceColor(
        document,
        target.layerId,
        target.frameId,
        action.fromColorIndex,
        action.toColorIndex,
        action.selectionOnly ? requireSelection(document) : undefined
      ), reason);
    case "move_selection":
      return withReason(moveSelection(document, requireSelection(document), action.dx, action.dy), reason);
    case "flip_selection":
      return withReason(flipSelection(document, requireSelection(document), action.axis), reason);
    case "paint_normals": {
      const bounded = action.requireSelection ?? Boolean(selection);
      const activeSelection = bounded ? requireSelection(document) : undefined;
      const normals = getNormalPixels(document, target.layerId, target.frameId);
      const changes = action.pixels.map(({ x, y, normal }) => {
        const index = pixelIndex(document, x, y);
        return { index, before: normals[index]!, after: normal };
      });
      return createNormalPixelPatch(document, target.layerId, target.frameId, changes, activeSelection, reason);
    }
    case "reset_selection_normals":
      return withReason(clearNormalSelection(document, requireSelection(document)), reason);
    case "add_palette_color":
      return withReason(addPaletteColor(document, action.color), reason);
    case "remove_palette_color":
      return withReason(removePaletteColor(document, action.colorIndex, action.replacementIndex), reason);
    case "replace_palette_color":
      return withReason(mergePaletteColors(document, action.fromColorIndex, action.toColorIndex), reason);
    case "reorder_palette_color":
      return withReason(reorderPaletteColor(document, action.fromIndex, action.toIndex), reason);
    case "add_layer":
      return withReason(addLayer(document, action.name), reason);
    case "remove_layer":
      return withReason(removeLayer(document, action.layerId), reason);
    case "duplicate_layer":
      return withReason(duplicateLayer(document, action.layerId), reason);
    case "rename_layer":
      return withReason(renameLayer(document, action.layerId, action.name), reason);
    case "reorder_layer":
      return withReason(reorderLayer(document, action.layerId, action.toIndex), reason);
    case "set_layer_visibility":
      return withReason(setLayerVisibility(document, action.layerId, action.visible), reason);
    case "set_layer_opacity":
      return withReason(setLayerOpacity(document, action.layerId, action.opacity), reason);
    case "add_frame":
      return withReason(addFrame(document, action.name ?? `Frame ${document.frames.length + 1}`, action.durationMs ?? 100), reason);
    case "remove_frame":
      return withReason(removeFrame(document, action.frameId), reason);
    case "duplicate_frame":
      return withReason(duplicateFrame(document, action.frameId), reason);
    case "rename_frame":
      return withReason(renameFrame(document, action.frameId, action.name), reason);
    case "reorder_frame":
      return withReason(reorderFrame(document, action.frameId, action.toIndex), reason);
    case "set_frame_duration":
      return withReason(setFrameDuration(document, action.frameId, action.durationMs), reason);
    case "set_frame_lighting":
      return withReason(setFrameLighting(document, action.frameId, action.lighting), reason);
    case "set_lighting_interpolation":
      return withReason(setFrameLightingInterpolation(document, action.frameId, action.interpolation), reason);
    case "remove_lighting_keyframe":
      return withReason(removeFrameLightingKeyframe(document, action.frameId), reason);
    case "create_clip":
    case "remove_clip":
    case "rename_clip":
    case "set_clip_frames":
    case "reorder_clip":
    case "rename_project":
      throw new Error(`${action.type} must be applied to a Pixel Project transaction.`);
  }
}

export function isProjectAction(action: EditablePixelAction): action is Extract<
  EditablePixelAction,
  { type: "create_clip" | "remove_clip" | "rename_clip" | "set_clip_frames" | "reorder_clip" | "rename_project" }
> {
  return ["create_clip", "remove_clip", "rename_clip", "set_clip_frames", "reorder_clip", "rename_project"].includes(action.type);
}

export function applyProjectAction(project: PixelProject, action: Extract<
  EditablePixelAction,
  { type: "create_clip" | "remove_clip" | "rename_clip" | "set_clip_frames" | "reorder_clip" | "rename_project" }
>): PixelProject {
  const next = structuredClone(project);
  if (action.type === "rename_project") {
    const name = action.name.trim();
    if (!name) throw new Error("Project name cannot be empty.");
    next.name = name;
  } else if (action.type === "create_clip") {
    assertFrameIds(next, action.frameIds);
    const name = action.name.trim();
    if (!name) throw new Error("Clip name cannot be empty.");
    const id = uniqueId("clip", next.clips.map((clip) => clip.id));
    detachFrames(next, action.frameIds);
    next.clips = next.clips.filter((clip) => clip.frameIds.length > 0);
    next.clips.push({ id, name, frameIds: [...new Set(action.frameIds)] });
    next.active = {
      ...next.active,
      clipId: id,
      frameId: action.frameIds[0]
    };
  } else if (action.type === "remove_clip") {
    if (next.clips.length === 1) throw new Error("A Project must keep at least one Clip.");
    const index = next.clips.findIndex((clip) => clip.id === action.clipId);
    if (index < 0) throw new Error(`Unknown clip: ${action.clipId}`);
    const [removed] = next.clips.splice(index, 1);
    const target = next.clips[Math.min(index, next.clips.length - 1)]!;
    target.frameIds.push(...removed!.frameIds);
    next.active = { ...next.active, clipId: target.id, frameId: target.frameIds[0] };
  } else if (action.type === "rename_clip") {
    const clip = next.clips.find((candidate) => candidate.id === action.clipId);
    if (!clip) throw new Error(`Unknown clip: ${action.clipId}`);
    const name = action.name.trim();
    if (!name) throw new Error("Clip name cannot be empty.");
    clip.name = name;
  } else if (action.type === "set_clip_frames") {
    if (action.frameIds.length === 0) throw new Error("A Clip must keep at least one Frame.");
    assertFrameIds(next, action.frameIds);
    const clip = next.clips.find((candidate) => candidate.id === action.clipId);
    if (!clip) throw new Error(`Unknown clip: ${action.clipId}`);
    const current = [...clip.frameIds].sort();
    const requested = [...new Set(action.frameIds)].sort();
    if (JSON.stringify(current) !== JSON.stringify(requested)) {
      throw new Error("set_clip_frames reorders the Clip's existing Frames. Use create_clip to move Frames into a new Clip.");
    }
    clip.frameIds = [...new Set(action.frameIds)];
    next.active = { ...next.active, clipId: clip.id, frameId: clip.frameIds[0] };
  } else {
    const index = next.clips.findIndex((clip) => clip.id === action.clipId);
    if (index < 0) throw new Error(`Unknown clip: ${action.clipId}`);
    if (!Number.isInteger(action.toIndex) || action.toIndex < 0 || action.toIndex >= next.clips.length) {
      throw new RangeError("Clip index is out of range.");
    }
    const [clip] = next.clips.splice(index, 1);
    next.clips.splice(action.toIndex, 0, clip!);
  }
  next.revision = project.revision + 1;
  next.updatedAt = new Date().toISOString();
  assertPixelProject(next);
  return next;
}

export function createSelection(
  document: PixelDocument,
  command: SelectionCommand,
  fallback: { layerId: string; frameId: string }
): Selection | undefined {
  if (command.type === "clear") return undefined;
  const layerId = command.layerId ?? fallback.layerId;
  const frameId = command.frameId ?? fallback.frameId;
  assertTarget(document, layerId, frameId);
  let indices: number[];
  if (command.type === "rect") {
    assertRect(document, command);
    indices = [];
    for (let y = command.y; y < command.y + command.height; y += 1) {
      for (let x = command.x; x < command.x + command.width; x += 1) {
        indices.push(y * document.canvas.width + x);
      }
    }
  } else if (command.type === "pixels") {
    indices = command.pixels.map(({ x, y }) => pixelIndex(document, x, y));
  } else if (command.type === "color") {
    if (command.colorIndex < 0 || command.colorIndex >= document.palette.length) {
      throw new RangeError(`Palette index ${command.colorIndex} is out of range.`);
    }
    const pixels = getPixels(document, layerId, frameId);
    indices = pixels.flatMap((color, index): number[] => color === command.colorIndex ? [index] : []);
  } else if (command.type === "connected") {
    indices = connectedIndices(document, layerId, frameId, command.x, command.y);
  } else if (command.type === "outline") {
    indices = outlineIndices(document, layerId, frameId);
  } else {
    const bounds = document.contentBounds;
    indices = [];
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
        indices.push(y * document.canvas.width + x);
      }
    }
  }
  const merged = mergeSelectionIndices(
    document.selection,
    indices,
    command.mode ?? "replace",
    document.canvas.width,
    layerId,
    frameId
  );
  return selectionFromIndices(merged, document.canvas.width, layerId, frameId);
}

function targetIds(
  document: PixelDocument,
  action: EditablePixelAction,
  fallback?: { layerId: string; frameId: string }
): { layerId: string; frameId: string } {
  const withTarget = action as { layerId?: string; frameId?: string };
  const layerId = withTarget.layerId ?? document.selection?.layerId ?? fallback?.layerId ?? document.layers[0]!.id;
  const frameId = withTarget.frameId ?? document.selection?.frameId ?? fallback?.frameId ?? document.frames[0]!.id;
  assertTarget(document, layerId, frameId);
  return { layerId, frameId };
}

function assertTarget(document: PixelDocument, layerId: string, frameId: string): void {
  if (!document.layers.some((layer) => layer.id === layerId)) throw new Error(`Unknown layer: ${layerId}`);
  if (!document.frames.some((frame) => frame.id === frameId)) throw new Error(`Unknown frame: ${frameId}`);
}

function requireSelection(document: PixelDocument): Selection {
  if (!document.selection) throw new Error("An active selection is required for this action.");
  return document.selection;
}

function pixelIndex(document: PixelDocument, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= document.canvas.width || y >= document.canvas.height) {
    throw new RangeError(`Pixel (${x}, ${y}) is outside the canvas.`);
  }
  return y * document.canvas.width + x;
}

function assertRect(document: PixelDocument, rect: { x: number; y: number; width: number; height: number }): void {
  if (
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > document.canvas.width ||
    rect.y + rect.height > document.canvas.height
  ) {
    throw new RangeError("Selection rectangle is outside the canvas.");
  }
}

function selectionIndices(selection: Selection, width: number): number[] {
  if (selection.type === "mask") return [...selection.indices];
  const indices: number[] = [];
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) indices.push(y * width + x);
  }
  return indices;
}

function mergeSelectionIndices(
  current: Selection | undefined,
  next: number[],
  mode: "replace" | "add" | "remove" | "toggle",
  width: number,
  layerId: string,
  frameId: string
): number[] {
  const currentIndices = current && current.layerId === layerId && current.frameId === frameId
    ? selectionIndices(current, width)
    : [];
  if (mode === "replace") return uniqueSorted(next);
  const values = new Set(currentIndices);
  for (const index of next) {
    if (mode === "remove") values.delete(index);
    else if (mode === "toggle") {
      if (values.has(index)) values.delete(index);
      else values.add(index);
    }
    else values.add(index);
  }
  return uniqueSorted([...values]);
}

function selectionFromIndices(
  indices: number[],
  width: number,
  layerId: string,
  frameId: string
): Selection | undefined {
  if (indices.length === 0) return undefined;
  const xs = indices.map((index) => index % width);
  const ys = indices.map((index) => Math.floor(index / width));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const selectionWidth = right - x + 1;
  const selectionHeight = bottom - y + 1;
  const isRect = indices.length === selectionWidth * selectionHeight;
  return isRect
    ? { type: "rect", x, y, width: selectionWidth, height: selectionHeight, layerId, frameId }
    : { type: "mask", x, y, width: selectionWidth, height: selectionHeight, layerId, frameId, indices };
}

function connectedIndices(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number
): number[] {
  const start = pixelIndex(document, x, y);
  const pixels = getPixels(document, layerId, frameId);
  const target = pixels[start]!;
  const visited = new Uint8Array(pixels.length);
  const queue = [start];
  const result: number[] = [];
  visited[start] = 1;
  while (queue.length) {
    const index = queue.pop()!;
    if (pixels[index] !== target) continue;
    result.push(index);
    const currentX = index % document.canvas.width;
    const currentY = Math.floor(index / document.canvas.width);
    const neighbors = [
      currentX > 0 ? index - 1 : -1,
      currentX + 1 < document.canvas.width ? index + 1 : -1,
      currentY > 0 ? index - document.canvas.width : -1,
      currentY + 1 < document.canvas.height ? index + document.canvas.width : -1
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && !visited[neighbor]) {
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  return uniqueSorted(result);
}

function outlineIndices(document: PixelDocument, layerId: string, frameId: string): number[] {
  const pixels = getPixels(document, layerId, frameId);
  const transparent = document.transparentColorIndex;
  return pixels.flatMap((color, index): number[] => {
    if (color === transparent) return [];
    const x = index % document.canvas.width;
    const y = Math.floor(index / document.canvas.width);
    const boundary = x === 0 || y === 0 || x === document.canvas.width - 1 || y === document.canvas.height - 1;
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x + 1 < document.canvas.width ? index + 1 : -1,
      y > 0 ? index - document.canvas.width : -1,
      y + 1 < document.canvas.height ? index + document.canvas.width : -1
    ];
    return boundary || neighbors.some((neighbor) => neighbor >= 0 && pixels[neighbor] === transparent) ? [index] : [];
  });
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueId(prefix: string, existing: string[]): string {
  let suffix = existing.length + 1;
  let candidate = `${prefix}-${suffix}`;
  while (existing.includes(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}

function assertFrameIds(project: PixelProject, frameIds: string[]): void {
  if (frameIds.length === 0) throw new Error("Choose at least one Frame.");
  const valid = new Set(project.document.frames.map((frame) => frame.id));
  for (const frameId of frameIds) {
    if (!valid.has(frameId)) throw new Error(`Unknown frame: ${frameId}`);
  }
  if (!frameIds.some((frameId) => project.document.frames.find((frame) => frame.id === frameId)?.lighting)) {
    const frame = project.document.frames.find((candidate) => candidate.id === frameIds[0])!;
    frame.lighting = { ...DEFAULT_FRAME_LIGHTING, x: 0.5, y: 0.25, height: 1, intensity: 1, ambient: 0.35 };
    frame.lightingInterpolation = "hold";
  }
}

function detachFrames(project: PixelProject, frameIds: string[], exceptClipId?: string): void {
  const moving = new Set(frameIds);
  for (const clip of project.clips) {
    if (clip.id === exceptClipId) continue;
    clip.frameIds = clip.frameIds.filter((frameId) => !moving.has(frameId));
  }
}

function withReason<T extends Patch>(patch: T, reason: string): T {
  return { ...patch, reason };
}
