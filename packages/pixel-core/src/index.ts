import {
  DEFAULT_FRAME_LIGHTING,
  NEUTRAL_NORMAL,
  assertPixelDocument,
  computeContentBounds,
  createDocumentId,
  type FrameLightingInterpolation,
  type Layer,
  type PixelDocument,
  type Rect,
  type Region,
  type Selection
} from "@editable-pixel/document";

export interface PixelChange {
  index: number;
  before: number;
  after: number;
}

interface PatchBase {
  id: string;
  documentId: string;
  baseRevision: number;
  reason: string;
  createdAt: string;
}

export interface PixelPatch extends PatchBase {
  kind: "pixels";
  layerId: string;
  frameId: string;
  bounds: Rect;
  selection?: Selection;
  outsideSelectionHash?: string;
  changes: PixelChange[];
}

export interface PalettePixelPatch extends PatchBase {
  kind: "palette-pixels";
  layerId: string;
  frameId: string;
  bounds: Rect;
  selection?: Selection;
  outsideSelectionHash?: string;
  newColors: string[];
  changes: PixelChange[];
}

export interface NormalPixelPatch extends PatchBase {
  kind: "normal-pixels";
  layerId: string;
  frameId: string;
  bounds: Rect;
  selection?: Selection;
  outsideSelectionHash?: string;
  changes: PixelChange[];
}

export interface DocumentPatch extends PatchBase {
  kind: "document";
  before: PixelDocument;
  after: PixelDocument;
}

export type Patch = PixelPatch | PalettePixelPatch | NormalPixelPatch | DocumentPatch;

export class PatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchConflictError";
  }
}

export function setPixel(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  colorIndex: number,
  selection?: Selection,
  reason = "Set pixel"
): PixelPatch {
  assertCoordinate(document, x, y);
  assertPaletteIndex(document, colorIndex);
  const pixels = getPixels(document, layerId, frameId);
  const index = y * document.canvas.width + x;
  return createPixelPatch(document, layerId, frameId, [
    { index, before: pixels[index]!, after: colorIndex }
  ], selection, reason);
}

export function erasePixel(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  selection?: Selection
): PixelPatch {
  return setPixel(
    document,
    layerId,
    frameId,
    x,
    y,
    document.transparentColorIndex,
    selection,
    "Erase pixel"
  );
}

export function drawLine(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  colorIndex: number,
  selection?: Selection
): PixelPatch {
  assertPaletteIndex(document, colorIndex);
  const pixels = getPixels(document, layerId, frameId);
  const changes: PixelChange[] = [];
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const sx = start.x < end.x ? 1 : -1;
  const dy = -Math.abs(end.y - start.y);
  const sy = start.y < end.y ? 1 : -1;
  let error = dx + dy;

  while (true) {
    assertCoordinate(document, x, y);
    const index = y * document.canvas.width + x;
    changes.push({ index, before: pixels[index]!, after: colorIndex });
    if (x === end.x && y === end.y) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }

  return createPixelPatch(document, layerId, frameId, changes, selection, "Draw line");
}

export function fill(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  colorIndex: number,
  selection?: Selection
): PixelPatch {
  assertCoordinate(document, x, y);
  assertPaletteIndex(document, colorIndex);
  const pixels = getPixels(document, layerId, frameId);
  const width = document.canvas.width;
  const height = document.canvas.height;
  const startIndex = y * width + x;
  const target = pixels[startIndex]!;
  if (target === colorIndex) {
    return createPixelPatch(document, layerId, frameId, [], selection, "Fill");
  }

  const queued = new Uint8Array(pixels.length);
  const queue = [startIndex];
  queued[startIndex] = 1;
  const changes: PixelChange[] = [];

  while (queue.length > 0) {
    const index = queue.pop()!;
    if (pixels[index] !== target) continue;
    const currentX = index % width;
    const currentY = Math.floor(index / width);
    if (selection && !contains(selection, width, currentX, currentY)) continue;
    changes.push({ index, before: target, after: colorIndex });

    const neighbors = [
      currentX > 0 ? index - 1 : -1,
      currentX + 1 < width ? index + 1 : -1,
      currentY > 0 ? index - width : -1,
      currentY + 1 < height ? index + width : -1
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && queued[neighbor] === 0) {
        queued[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }

  return createPixelPatch(document, layerId, frameId, changes, selection, "Fill");
}

export function setNormalPixel(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  normal: number,
  selection?: Selection,
  reason = "Paint normal"
): NormalPixelPatch {
  assertCoordinate(document, x, y);
  assertPackedNormal(normal);
  const normals = getNormalPixels(document, layerId, frameId);
  const index = y * document.canvas.width + x;
  return createNormalPixelPatch(document, layerId, frameId, [
    { index, before: normals[index]!, after: normal }
  ], selection, reason);
}

export function resetNormalPixel(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  selection?: Selection
): NormalPixelPatch {
  return setNormalPixel(document, layerId, frameId, x, y, NEUTRAL_NORMAL, selection, "Reset normal");
}

export function fillNormal(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  x: number,
  y: number,
  normal: number,
  selection?: Selection
): NormalPixelPatch {
  assertCoordinate(document, x, y);
  assertPackedNormal(normal);
  const normals = getNormalPixels(document, layerId, frameId);
  const width = document.canvas.width;
  const height = document.canvas.height;
  const startIndex = y * width + x;
  const target = normals[startIndex]!;
  if (target === normal) return createNormalPixelPatch(document, layerId, frameId, [], selection, "Fill normal");

  const queued = new Uint8Array(normals.length);
  const queue = [startIndex];
  const changes: PixelChange[] = [];
  queued[startIndex] = 1;
  while (queue.length > 0) {
    const index = queue.pop()!;
    if (normals[index] !== target) continue;
    const currentX = index % width;
    const currentY = Math.floor(index / width);
    if (selection && !contains(selection, width, currentX, currentY)) continue;
    changes.push({ index, before: target, after: normal });
    const neighbors = [
      currentX > 0 ? index - 1 : -1,
      currentX + 1 < width ? index + 1 : -1,
      currentY > 0 ? index - width : -1,
      currentY + 1 < height ? index + width : -1
    ];
    for (const neighbor of neighbors) {
      if (neighbor >= 0 && queued[neighbor] === 0) {
        queued[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  return createNormalPixelPatch(document, layerId, frameId, changes, selection, "Fill normal");
}

export function clearNormalSelection(document: PixelDocument, selection: Selection): NormalPixelPatch {
  const normals = getNormalPixels(document, selection.layerId, selection.frameId);
  const changes: PixelChange[] = [];
  forEachSelectedPixel(selection, document.canvas.width, (index) => {
    changes.push({ index, before: normals[index]!, after: NEUTRAL_NORMAL });
  });
  return createNormalPixelPatch(
    document,
    selection.layerId,
    selection.frameId,
    changes,
    selection,
    "Reset selected normals"
  );
}

export function resetNormalFrame(
  document: PixelDocument,
  layerId: string,
  frameId: string
): NormalPixelPatch {
  const normals = getNormalPixels(document, layerId, frameId);
  return createNormalPixelPatch(
    document,
    layerId,
    frameId,
    normals.map((before, index) => ({ index, before, after: NEUTRAL_NORMAL })),
    undefined,
    "Reset normal map"
  );
}

export function replaceColor(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  from: number,
  to: number,
  selection?: Selection
): PixelPatch {
  assertPaletteIndex(document, from);
  assertPaletteIndex(document, to);
  const pixels = getPixels(document, layerId, frameId);
  const changes = pixels.flatMap((pixel, index): PixelChange[] => {
    const x = index % document.canvas.width;
    const y = Math.floor(index / document.canvas.width);
    if (pixel !== from || (selection && !contains(selection, document.canvas.width, x, y))) return [];
    return [{ index, before: from, after: to }];
  });
  return createPixelPatch(document, layerId, frameId, changes, selection, "Replace color");
}

export function clearSelection(document: PixelDocument, selection: Selection): PixelPatch {
  const pixels = getPixels(document, selection.layerId, selection.frameId);
  const changes: PixelChange[] = [];
  forEachSelectedPixel(selection, document.canvas.width, (index) => {
    changes.push({
      index,
      before: pixels[index]!,
      after: document.transparentColorIndex
    });
  });
  return createPixelPatch(
    document,
    selection.layerId,
    selection.frameId,
    changes,
    selection,
    "Clear selection"
  );
}

export function moveSelection(
  document: PixelDocument,
  selection: Selection,
  dx: number,
  dy: number
): DocumentPatch {
  const translatedSelection = translateSelection(document, selection, dx, dy);
  const next = structuredClone(document);
  const pixels = getPixels(next, selection.layerId, selection.frameId);
  const source: Array<{ index: number; x: number; y: number; color: number }> = [];
  forEachSelectedPixel(selection, document.canvas.width, (index, x, y) => {
    source.push({ index, x, y, color: pixels[index]! });
    pixels[index] = document.transparentColorIndex;
  });
  for (const pixel of source) {
    const targetX = pixel.x + dx;
    const targetY = pixel.y + dy;
    pixels[targetY * document.canvas.width + targetX] = pixel.color;
  }
  next.selection = translatedSelection;
  next.contentBounds = computeDocumentContentBounds(next);
  return createDocumentPatch(document, next, "Move selection");
}

export function copySelection(
  document: PixelDocument,
  selection: Selection,
  dx: number,
  dy: number
): PixelPatch {
  const pixels = getPixels(document, selection.layerId, selection.frameId);
  const changes: PixelChange[] = [];
  forEachSelectedPixel(selection, document.canvas.width, (_index, x, y) => {
    const targetX = x + dx;
    const targetY = y + dy;
    if (
      targetX < 0 ||
      targetY < 0 ||
      targetX >= document.canvas.width ||
      targetY >= document.canvas.height
    ) return;
    const sourceIndex = y * document.canvas.width + x;
    const targetIndex = targetY * document.canvas.width + targetX;
    changes.push({ index: targetIndex, before: pixels[targetIndex]!, after: pixels[sourceIndex]! });
  });
  return createPixelPatch(document, selection.layerId, selection.frameId, changes, undefined, "Copy selection");
}

export function flipSelection(
  document: PixelDocument,
  selection: Selection,
  axis: "horizontal" | "vertical"
): PixelPatch {
  const pixels = getPixels(document, selection.layerId, selection.frameId);
  const changes: PixelChange[] = [];
  forEachSelectedPixel(selection, document.canvas.width, (index, x, y) => {
    const sourceX = axis === "horizontal" ? selection.x + selection.width - 1 - (x - selection.x) : x;
    const sourceY = axis === "vertical" ? selection.y + selection.height - 1 - (y - selection.y) : y;
    const sourceIndex = sourceY * document.canvas.width + sourceX;
    changes.push({ index, before: pixels[index]!, after: pixels[sourceIndex]! });
  });
  return createPixelPatch(
    document,
    selection.layerId,
    selection.frameId,
    changes,
    selection,
    `Flip selection ${axis}`
  );
}

export function createPixelPatch(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  rawChanges: PixelChange[],
  selection: Selection | undefined,
  reason: string
): PixelPatch {
  const pixels = getPixels(document, layerId, frameId);
  const byIndex = new Map<number, PixelChange>();
  for (const change of rawChanges) {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= pixels.length) {
      throw new RangeError(`Pixel index ${change.index} is outside the canvas.`);
    }
    assertPaletteIndex(document, change.after);
    if (selection) {
      const x = change.index % document.canvas.width;
      const y = Math.floor(change.index / document.canvas.width);
      if (!contains(selection, document.canvas.width, x, y)) {
        throw new RangeError("Bounded edits cannot change pixels outside the selection.");
      }
    }
    if (change.before !== pixels[change.index]) {
      throw new PatchConflictError(`Pixel ${change.index} does not match the document.`);
    }
    if (change.before !== change.after) byIndex.set(change.index, change);
  }
  const changes = [...byIndex.values()].sort((left, right) => left.index - right.index);
  const bounds = boundsForChanges(changes, document.canvas.width);
  const base = {
    documentId: document.id,
    baseRevision: document.revision,
    layerId,
    frameId,
    bounds,
    ...(selection ? { selection, outsideSelectionHash: hashOutsideSelection(pixels, document.canvas.width, selection) } : {}),
    changes,
    reason,
    createdAt: new Date().toISOString()
  };
  return {
    kind: "pixels",
    id: createDocumentId(base),
    ...base
  };
}

export function createNormalPixelPatch(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  rawChanges: PixelChange[],
  selection: Selection | undefined,
  reason: string
): NormalPixelPatch {
  const normals = getNormalPixels(document, layerId, frameId);
  const byIndex = new Map<number, PixelChange>();
  for (const change of rawChanges) {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= normals.length) {
      throw new RangeError(`Normal pixel index ${change.index} is outside the canvas.`);
    }
    assertPackedNormal(change.after);
    if (selection) {
      const x = change.index % document.canvas.width;
      const y = Math.floor(change.index / document.canvas.width);
      if (!contains(selection, document.canvas.width, x, y)) {
        throw new RangeError("Bounded edits cannot change normals outside the selection.");
      }
    }
    if (change.before !== normals[change.index]) {
      throw new PatchConflictError(`Normal pixel ${change.index} does not match the document.`);
    }
    if (change.before !== change.after) byIndex.set(change.index, change);
  }
  const changes = [...byIndex.values()].sort((left, right) => left.index - right.index);
  const base = {
    documentId: document.id,
    baseRevision: document.revision,
    layerId,
    frameId,
    bounds: boundsForChanges(changes, document.canvas.width),
    ...(selection ? {
      selection,
      outsideSelectionHash: hashOutsideSelection(normals, document.canvas.width, selection)
    } : {}),
    changes,
    reason,
    createdAt: new Date().toISOString()
  };
  return { kind: "normal-pixels", id: createDocumentId(base), ...base };
}

export function createPalettePixelPatch(
  document: PixelDocument,
  layerId: string,
  frameId: string,
  newColors: string[],
  rawChanges: PixelChange[],
  selection: Selection | undefined,
  reason: string
): PalettePixelPatch {
  const normalizedColors = newColors.map((color) => {
    assertColor(color);
    return color.toLowerCase();
  });
  if (normalizedColors.length === 0) throw new Error("A palette pixel patch must add at least one color.");
  if (document.palette.length + normalizedColors.length > 256) throw new Error("A palette cannot contain more than 256 colors.");
  if (new Set(normalizedColors).size !== normalizedColors.length) throw new Error("New palette colors must be unique.");
  if (normalizedColors.some((color) => document.palette.includes(color))) throw new Error("New palette colors must not already exist.");
  const pixels = getPixels(document, layerId, frameId);
  const byIndex = new Map<number, PixelChange>();
  for (const change of rawChanges) {
    if (!Number.isInteger(change.index) || change.index < 0 || change.index >= pixels.length) {
      throw new RangeError(`Pixel index ${change.index} is outside the canvas.`);
    }
    if (!Number.isInteger(change.after) || change.after < 0 || change.after >= document.palette.length + normalizedColors.length) {
      throw new RangeError(`Palette index ${change.after} is invalid after adding colors.`);
    }
    if (selection) {
      const x = change.index % document.canvas.width;
      const y = Math.floor(change.index / document.canvas.width);
      if (!contains(selection, document.canvas.width, x, y)) throw new RangeError("Bounded edits cannot change pixels outside the selection.");
    }
    if (change.before !== pixels[change.index]) throw new PatchConflictError(`Pixel ${change.index} does not match the document.`);
    if (change.before !== change.after) byIndex.set(change.index, change);
  }
  const changes = [...byIndex.values()].sort((left, right) => left.index - right.index);
  const base = {
    documentId: document.id,
    baseRevision: document.revision,
    layerId,
    frameId,
    bounds: boundsForChanges(changes, document.canvas.width),
    ...(selection ? { selection, outsideSelectionHash: hashOutsideSelection(pixels, document.canvas.width, selection) } : {}),
    newColors: normalizedColors,
    changes,
    reason,
    createdAt: new Date().toISOString()
  };
  return { kind: "palette-pixels", id: createDocumentId(base), ...base };
}

export function createDocumentPatch(
  document: PixelDocument,
  after: PixelDocument,
  reason: string
): DocumentPatch {
  assertPixelDocument(after);
  const next = structuredClone(after);
  next.id = document.id;
  next.revision = document.revision + 1;
  const base = {
    documentId: document.id,
    baseRevision: document.revision,
    before: structuredClone(document),
    after: next,
    reason,
    createdAt: new Date().toISOString()
  };
  return { kind: "document", id: createDocumentId(base), ...base };
}

export function applyPatch(document: PixelDocument, patch: Patch): PixelDocument {
  if (patch.documentId !== document.id) {
    throw new PatchConflictError("Patch targets a different document.");
  }
  if (patch.baseRevision !== document.revision) {
    throw new PatchConflictError(
      `Patch revision ${patch.baseRevision} does not match document revision ${document.revision}.`
    );
  }

  if (patch.kind === "document") {
    if (JSON.stringify(patch.before) !== JSON.stringify(document)) {
      throw new PatchConflictError("Document snapshot no longer matches the patch base.");
    }
    const next = structuredClone(patch.after);
    assertPixelDocument(next);
    return next;
  }

  const next = structuredClone(document);
  if (patch.kind === "palette-pixels") next.palette.push(...patch.newColors);
  const pixels = patch.kind === "normal-pixels"
    ? getOrCreateNormalPixels(next, patch.layerId, patch.frameId)
    : getPixels(next, patch.layerId, patch.frameId);
  if (patch.selection && patch.outsideSelectionHash !== hashOutsideSelection(pixels, next.canvas.width, patch.selection)) {
    throw new PatchConflictError("Pixels outside the selection changed after the patch was created.");
  }
  for (const change of patch.changes) {
    if (patch.selection) {
      const x = change.index % next.canvas.width;
      const y = Math.floor(change.index / next.canvas.width);
      if (!contains(patch.selection, next.canvas.width, x, y)) {
        throw new PatchConflictError("Bounded edits cannot change pixels outside the selection.");
      }
    }
    if (pixels[change.index] !== change.before) {
      throw new PatchConflictError(`Pixel ${change.index} changed after the patch was created.`);
    }
    if (patch.kind === "normal-pixels") assertPackedNormal(change.after);
    else if (change.after < 0 || change.after >= next.palette.length) {
      throw new PatchConflictError(`Palette index ${change.after} is not available for this patch.`);
    }
    pixels[change.index] = change.after;
  }
  next.revision += 1;
  next.metadata.modifiedBy = "editable-pixel-patch";
  if (patch.kind !== "normal-pixels") next.contentBounds = computeDocumentContentBounds(next);
  assertPixelDocument(next);
  return next;
}

export function invertPatch(patch: Patch, appliedDocument: PixelDocument): Patch {
  if (patch.kind === "document") {
    return createDocumentPatch(appliedDocument, patch.before, `Undo: ${patch.reason}`);
  }
  if (patch.kind === "palette-pixels") {
    const before = structuredClone(appliedDocument);
    const pixels = getPixels(before, patch.layerId, patch.frameId);
    for (const change of patch.changes) pixels[change.index] = change.before;
    before.palette.splice(-patch.newColors.length, patch.newColors.length);
    before.contentBounds = computeDocumentContentBounds(before);
    return createDocumentPatch(appliedDocument, before, `Undo: ${patch.reason}`);
  }
  if (patch.kind === "normal-pixels") {
    return createNormalPixelPatch(
      appliedDocument,
      patch.layerId,
      patch.frameId,
      patch.changes.map((change) => ({
        index: change.index,
        before: change.after,
        after: change.before
      })),
      patch.selection,
      `Undo: ${patch.reason}`
    );
  }
  return createPixelPatch(
    appliedDocument,
    patch.layerId,
    patch.frameId,
    patch.changes.map((change) => ({
      index: change.index,
      before: change.after,
      after: change.before
    })),
    patch.selection,
    `Undo: ${patch.reason}`
  );
}

export class PatchHistory {
  #past: Array<{ before: PixelDocument; patch: Patch }> = [];
  #future: Array<{ before: PixelDocument; patch: Patch }> = [];

  apply(document: PixelDocument, patch: Patch): PixelDocument {
    const next = applyPatch(document, patch);
    this.#past.push({ before: structuredClone(document), patch });
    this.#future = [];
    return next;
  }

  undo(document: PixelDocument): PixelDocument {
    const entry = this.#past.pop();
    if (!entry) return document;
    this.#future.push({ before: structuredClone(entry.before), patch: entry.patch });
    const restored = structuredClone(entry.before);
    restored.revision = document.revision + 1;
    restored.metadata.modifiedBy = "editable-pixel-undo";
    return restored;
  }

  redo(document: PixelDocument): PixelDocument {
    const entry = this.#future.pop();
    if (!entry) return document;
    const rebased = rebasePatch(entry.patch, document);
    const next = applyPatch(document, rebased);
    this.#past.push({ before: structuredClone(document), patch: rebased });
    return next;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }
}

function rebasePatch(patch: Patch, document: PixelDocument): Patch {
  if (patch.kind === "document") {
    return createDocumentPatch(document, patch.after, patch.reason);
  }
  const pixels = patch.kind === "normal-pixels"
    ? getNormalPixels(document, patch.layerId, patch.frameId)
    : getPixels(document, patch.layerId, patch.frameId);
  if (patch.kind === "palette-pixels") {
    return createPalettePixelPatch(
      document,
      patch.layerId,
      patch.frameId,
      patch.newColors,
      patch.changes.map((change) => ({ index: change.index, before: pixels[change.index]!, after: change.after })),
      patch.selection,
      patch.reason
    );
  }
  if (patch.kind === "normal-pixels") {
    return createNormalPixelPatch(
      document,
      patch.layerId,
      patch.frameId,
      patch.changes.map((change) => ({
        index: change.index,
        before: pixels[change.index]!,
        after: change.after
      })),
      patch.selection,
      patch.reason
    );
  }
  return createPixelPatch(
    document,
    patch.layerId,
    patch.frameId,
    patch.changes.map((change) => ({
      index: change.index,
      before: pixels[change.index]!,
      after: change.after
    })),
    patch.selection,
    patch.reason
  );
}

export function getPixels(document: PixelDocument, layerId: string, frameId: string): number[] {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  const pixels = layer.frames[frameId];
  if (!pixels) throw new Error(`Unknown frame: ${frameId}`);
  return pixels;
}

export function getNormalPixels(document: PixelDocument, layerId: string, frameId: string): number[] {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  if (!document.frames.some((frame) => frame.id === frameId)) throw new Error(`Unknown frame: ${frameId}`);
  return layer.normalFrames?.[frameId]
    ?? Array.from({ length: document.canvas.width * document.canvas.height }, () => NEUTRAL_NORMAL);
}

function getOrCreateNormalPixels(document: PixelDocument, layerId: string, frameId: string): number[] {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  if (!document.frames.some((frame) => frame.id === frameId)) throw new Error(`Unknown frame: ${frameId}`);
  layer.normalFrames ??= Object.fromEntries(document.frames.map((frame) => [
    frame.id,
    Array.from({ length: document.canvas.width * document.canvas.height }, () => NEUTRAL_NORMAL)
  ]));
  return layer.normalFrames[frameId]!;
}

export function addLayer(document: PixelDocument, name: string): DocumentPatch {
  const next = structuredClone(document);
  const id = uniqueId("layer", next.layers.map((layer) => layer.id));
  const frames = Object.fromEntries(
    next.frames.map((frame) => [
      frame.id,
      Array.from({ length: next.canvas.width * next.canvas.height }, () => next.transparentColorIndex)
    ])
  );
  next.layers.push({ id, name, visible: true, opacity: 1, blendMode: "normal", frames });
  return createDocumentPatch(document, next, "Add layer");
}

export function removeLayer(document: PixelDocument, layerId: string): DocumentPatch {
  if (document.layers.length === 1) throw new Error("A document must keep at least one layer.");
  const next = structuredClone(document);
  next.layers = next.layers.filter((layer) => layer.id !== layerId);
  if (next.layers.length === document.layers.length) throw new Error(`Unknown layer: ${layerId}`);
  next.regions = next.regions.filter((region) => region.layerId !== layerId);
  if (next.selection?.layerId === layerId) delete next.selection;
  next.contentBounds = computeDocumentContentBounds(next);
  return createDocumentPatch(document, next, "Remove layer");
}

export function duplicateLayer(document: PixelDocument, layerId: string): DocumentPatch {
  const source = document.layers.find((layer) => layer.id === layerId);
  if (!source) throw new Error(`Unknown layer: ${layerId}`);
  const next = structuredClone(document);
  const copy = structuredClone(source);
  copy.id = uniqueId(`${source.id}-copy`, next.layers.map((layer) => layer.id));
  copy.name = `${source.name} copy`;
  next.layers.push(copy);
  return createDocumentPatch(document, next, "Duplicate layer");
}

export function pasteLayer(document: PixelDocument, source: Layer): DocumentPatch {
  const next = structuredClone(document);
  const copy = structuredClone(source);
  copy.id = uniqueId(`${source.id}-copy`, next.layers.map((layer) => layer.id));
  copy.name = `${source.name} copy`;
  copy.frames = Object.fromEntries(next.frames.map((frame) => [
    frame.id,
    source.frames[frame.id]
      ? [...source.frames[frame.id]!]
      : Array.from({ length: next.canvas.width * next.canvas.height }, () => next.transparentColorIndex)
  ]));
  if (source.normalFrames) {
    copy.normalFrames = Object.fromEntries(next.frames.map((frame) => [
      frame.id,
      source.normalFrames?.[frame.id]
        ? [...source.normalFrames[frame.id]!]
        : Array.from({ length: next.canvas.width * next.canvas.height }, () => NEUTRAL_NORMAL)
    ]));
  }
  next.layers.push(copy);
  return createDocumentPatch(document, next, "Paste layer");
}

export function reorderLayer(document: PixelDocument, layerId: string, toIndex: number): DocumentPatch {
  const next = structuredClone(document);
  const fromIndex = next.layers.findIndex((layer) => layer.id === layerId);
  if (fromIndex < 0) throw new Error(`Unknown layer: ${layerId}`);
  if (toIndex < 0 || toIndex >= next.layers.length) throw new RangeError("Layer index is out of range.");
  const [layer] = next.layers.splice(fromIndex, 1);
  next.layers.splice(toIndex, 0, layer!);
  return createDocumentPatch(document, next, "Reorder layer");
}

export function renameLayer(document: PixelDocument, layerId: string, name: string): DocumentPatch {
  const nextName = name.trim();
  if (!nextName) throw new Error("Layer name cannot be empty.");
  if (nextName.length > 128) throw new Error("Layer name cannot exceed 128 characters.");
  const next = structuredClone(document);
  const layer = next.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  layer.name = nextName;
  return createDocumentPatch(document, next, "Rename layer");
}

export function setLayerVisibility(
  document: PixelDocument,
  layerId: string,
  visible: boolean
): DocumentPatch {
  const next = structuredClone(document);
  const layer = next.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  layer.visible = visible;
  return createDocumentPatch(document, next, "Set layer visibility");
}

export function setLayerOpacity(
  document: PixelDocument,
  layerId: string,
  opacity: number
): DocumentPatch {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError("Layer opacity must be between 0 and 1.");
  }
  const next = structuredClone(document);
  const layer = next.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`Unknown layer: ${layerId}`);
  layer.opacity = opacity;
  return createDocumentPatch(document, next, "Set layer opacity");
}

export function addFrame(
  document: PixelDocument,
  name: string,
  durationMs = 100,
  lighting: NonNullable<PixelDocument["frames"][number]["lighting"]> = DEFAULT_FRAME_LIGHTING
): DocumentPatch {
  const next = structuredClone(document);
  const id = uniqueId("frame", next.frames.map((frame) => frame.id));
  next.frames.push({ id, name, durationMs, lighting: { ...lighting } });
  for (const layer of next.layers) {
    layer.frames[id] = Array.from(
      { length: next.canvas.width * next.canvas.height },
      () => next.transparentColorIndex
    );
    if (layer.normalFrames) {
      layer.normalFrames[id] = Array.from(
        { length: next.canvas.width * next.canvas.height },
        () => NEUTRAL_NORMAL
      );
    }
  }
  return createDocumentPatch(document, next, "Add frame");
}

export function removeFrame(document: PixelDocument, frameId: string): DocumentPatch {
  if (document.frames.length === 1) throw new Error("A document must keep at least one frame.");
  const next = structuredClone(document);
  next.frames = next.frames.filter((frame) => frame.id !== frameId);
  if (next.frames.length === document.frames.length) throw new Error(`Unknown frame: ${frameId}`);
  for (const layer of next.layers) {
    delete layer.frames[frameId];
    if (layer.normalFrames) delete layer.normalFrames[frameId];
  }
  next.regions = next.regions.filter((region) => region.frameId !== frameId);
  if (next.selection?.frameId === frameId) delete next.selection;
  next.contentBounds = computeDocumentContentBounds(next);
  return createDocumentPatch(document, next, "Remove frame");
}

export function duplicateFrame(document: PixelDocument, frameId: string): DocumentPatch {
  const source = document.frames.find((frame) => frame.id === frameId);
  if (!source) throw new Error(`Unknown frame: ${frameId}`);
  const next = structuredClone(document);
  const id = uniqueId(`${source.id}-copy`, next.frames.map((frame) => frame.id));
  next.frames.push({ ...source, id, name: `${source.name} copy` });
  for (const layer of next.layers) {
    layer.frames[id] = [...layer.frames[frameId]!];
    if (layer.normalFrames) layer.normalFrames[id] = [...layer.normalFrames[frameId]!];
  }
  return createDocumentPatch(document, next, "Duplicate frame");
}

export function renameFrame(document: PixelDocument, frameId: string, name: string): DocumentPatch {
  const nextName = name.trim();
  if (!nextName) throw new Error("Frame name cannot be empty.");
  if (nextName.length > 128) throw new Error("Frame name cannot exceed 128 characters.");
  const next = structuredClone(document);
  const frame = next.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  frame.name = nextName;
  return createDocumentPatch(document, next, "Rename frame");
}

export function setFrameDuration(
  document: PixelDocument,
  frameId: string,
  durationMs: number
): DocumentPatch {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60_000) {
    throw new RangeError("Frame duration must be between 1 and 60000ms.");
  }
  const next = structuredClone(document);
  const frame = next.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  frame.durationMs = durationMs;
  return createDocumentPatch(document, next, "Set frame duration");
}

export function setFrameLighting(
  document: PixelDocument,
  frameId: string,
  lighting: NonNullable<PixelDocument["frames"][number]["lighting"]>
): DocumentPatch {
  const next = structuredClone(document);
  const frame = next.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  frame.lighting = { ...lighting };
  return createDocumentPatch(document, next, "Set frame lighting");
}

export function setFrameLightingInterpolation(
  document: PixelDocument,
  frameId: string,
  interpolation: FrameLightingInterpolation
): DocumentPatch {
  const next = structuredClone(document);
  const frame = next.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  if (!frame.lighting) throw new Error("Only a lighting keyframe can set interpolation.");
  frame.lightingInterpolation = interpolation;
  return createDocumentPatch(document, next, "Set lighting interpolation");
}

export function removeFrameLightingKeyframe(
  document: PixelDocument,
  frameId: string,
  orderedFrameIds: readonly string[] = document.frames.map((frame) => frame.id)
): DocumentPatch {
  const next = structuredClone(document);
  const frame = next.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error(`Unknown frame: ${frameId}`);
  if (!frame.lighting) throw new Error("This frame is already interpolated.");
  const remainingKeyframes = orderedFrameIds.filter((id) => id !== frameId && next.frames.find((candidate) => candidate.id === id)?.lighting);
  if (remainingKeyframes.length === 0) throw new Error("A clip must keep at least one lighting keyframe.");
  delete frame.lighting;
  delete frame.lightingInterpolation;
  return createDocumentPatch(document, next, "Remove lighting keyframe");
}

export function reorderFrame(document: PixelDocument, frameId: string, toIndex: number): DocumentPatch {
  const next = structuredClone(document);
  const fromIndex = next.frames.findIndex((frame) => frame.id === frameId);
  if (fromIndex < 0) throw new Error(`Unknown frame: ${frameId}`);
  if (toIndex < 0 || toIndex >= next.frames.length) throw new RangeError("Frame index is out of range.");
  const [frame] = next.frames.splice(fromIndex, 1);
  next.frames.splice(toIndex, 0, frame!);
  return createDocumentPatch(document, next, "Reorder frame");
}

export type ResizeAnchor = "top-left" | "center" | "bottom-center";

export function resizeCanvas(
  document: PixelDocument,
  width: number,
  height: number,
  anchor: ResizeAnchor = document.alignment
): DocumentPatch {
  assertDimension(width, "Canvas width");
  assertDimension(height, "Canvas height");
  const next = structuredClone(document);
  const offset = canvasOffset(document.canvas.width, document.canvas.height, width, height, anchor);

  for (const layer of next.layers) {
    for (const frame of next.frames) {
      layer.frames[frame.id] = copyPixelsToCanvas(
        layer.frames[frame.id]!,
        document.canvas.width,
        document.canvas.height,
        width,
        height,
        offset.x,
        offset.y,
        next.transparentColorIndex
      );
      if (layer.normalFrames) {
        layer.normalFrames[frame.id] = copyPixelsToCanvas(
          layer.normalFrames[frame.id]!,
          document.canvas.width,
          document.canvas.height,
          width,
          height,
          offset.x,
          offset.y,
          NEUTRAL_NORMAL
        );
      }
    }
  }

  next.canvas = { width, height };
  next.contentBox = clipRect(translateRect(document.contentBox, offset.x, offset.y), width, height);
  next.pivot = {
    x: clamp(document.pivot.x + offset.x, 0, width - 1),
    y: clamp(document.pivot.y + offset.y, 0, height - 1)
  };
  next.regions = document.regions.flatMap((region) => {
    const bounds = intersectRect(translateRect(region.bounds, offset.x, offset.y), width, height);
    return bounds ? [{ ...region, bounds }] : [];
  });
  if (document.selection) {
    if (document.selection.type === "rect") {
      const bounds = intersectRect(translateRect(document.selection, offset.x, offset.y), width, height);
      next.selection = bounds ? { ...document.selection, ...bounds } : undefined;
    } else {
      const indices = document.selection.indices.flatMap((index): number[] => {
        const x = index % document.canvas.width + offset.x;
        const y = Math.floor(index / document.canvas.width) + offset.y;
        return x >= 0 && y >= 0 && x < width && y < height ? [y * width + x] : [];
      });
      const bounds = boundsForIndices(indices, width);
      next.selection = bounds ? { ...document.selection, ...bounds, indices } : undefined;
    }
  }
  next.contentBounds = computeDocumentContentBounds(next);
  return createDocumentPatch(document, next, "Resize canvas");
}

export function resizeContent(document: PixelDocument, target: Rect): DocumentPatch {
  assertRectInsideCanvas(target, document.canvas.width, document.canvas.height, "Content box");
  const next = structuredClone(document);
  const source = document.contentBounds;

  for (const layer of next.layers) {
    for (const frame of next.frames) {
      const input = document.layers.find((candidate) => candidate.id === layer.id)!.frames[frame.id]!;
      const output = Array.from(
        { length: document.canvas.width * document.canvas.height },
        () => document.transparentColorIndex
      );
      for (let y = 0; y < target.height; y += 1) {
        for (let x = 0; x < target.width; x += 1) {
          const sourceX = source.x + Math.min(source.width - 1, Math.floor((x * source.width) / target.width));
          const sourceY = source.y + Math.min(source.height - 1, Math.floor((y * source.height) / target.height));
          output[(target.y + y) * document.canvas.width + target.x + x] =
            input[sourceY * document.canvas.width + sourceX]!;
        }
      }
      layer.frames[frame.id] = output;
      if (layer.normalFrames) {
        const normalInput = document.layers.find((candidate) => candidate.id === layer.id)!
          .normalFrames![frame.id]!;
        const normalOutput = Array.from(
          { length: document.canvas.width * document.canvas.height },
          () => NEUTRAL_NORMAL
        );
        for (let y = 0; y < target.height; y += 1) {
          for (let x = 0; x < target.width; x += 1) {
            const sourceX = source.x + Math.min(source.width - 1, Math.floor((x * source.width) / target.width));
            const sourceY = source.y + Math.min(source.height - 1, Math.floor((y * source.height) / target.height));
            normalOutput[(target.y + y) * document.canvas.width + target.x + x] =
              normalInput[sourceY * document.canvas.width + sourceX]!;
          }
        }
        layer.normalFrames[frame.id] = normalOutput;
      }
    }
  }

  next.contentBox = { ...target };
  next.pivot = {
    x: target.x + Math.floor(target.width / 2),
    y:
      document.alignment === "bottom-center"
        ? target.y + target.height - 1
        : target.y + Math.floor(target.height / 2)
  };
  next.regions = document.regions.map((region) => ({
    ...region,
    bounds: mapRect(region.bounds, source, target)
  }));
  if (document.selection) {
    next.selection = { ...document.selection, ...mapRect(document.selection, source, target) };
  }
  next.contentBounds = computeDocumentContentBounds(next);
  return createDocumentPatch(document, next, "Resize content");
}

export function addPaletteColor(document: PixelDocument, color: string): DocumentPatch {
  assertColor(color);
  if (document.palette.length >= 256) throw new Error("A palette cannot contain more than 256 colors.");
  if (document.palette.includes(color.toLowerCase())) throw new Error(`Palette already contains ${color}.`);
  const next = structuredClone(document);
  next.palette.push(color.toLowerCase());
  return createDocumentPatch(document, next, "Add palette color");
}

export function removePaletteColor(
  document: PixelDocument,
  index: number,
  replacementIndex = document.transparentColorIndex
): DocumentPatch {
  assertPaletteIndex(document, index);
  assertPaletteIndex(document, replacementIndex);
  if (document.palette.length === 1) throw new Error("A palette must keep at least one color.");
  if (index === document.transparentColorIndex) throw new Error("The transparent color cannot be removed.");
  if (index === replacementIndex) throw new Error("Replacement color must differ from the removed color.");
  const next = structuredClone(document);
  remapPalette(next, paletteRemovalMap(document.palette.length, index, replacementIndex));
  next.palette.splice(index, 1);
  return createDocumentPatch(document, next, "Remove palette color");
}

export function mergePaletteColors(
  document: PixelDocument,
  fromIndex: number,
  toIndex: number
): DocumentPatch {
  assertPaletteIndex(document, fromIndex);
  assertPaletteIndex(document, toIndex);
  if (fromIndex === toIndex) throw new Error("Palette colors to merge must differ.");
  if (fromIndex === document.transparentColorIndex) throw new Error("The transparent color cannot be merged away.");
  const next = structuredClone(document);
  remapPalette(next, paletteRemovalMap(document.palette.length, fromIndex, toIndex));
  next.palette.splice(fromIndex, 1);
  return createDocumentPatch(document, next, "Merge palette colors");
}

export function reorderPaletteColor(
  document: PixelDocument,
  fromIndex: number,
  toIndex: number
): DocumentPatch {
  assertPaletteIndex(document, fromIndex);
  assertPaletteIndex(document, toIndex);
  const next = structuredClone(document);
  const order = document.palette.map((_, index) => index);
  const [moved] = order.splice(fromIndex, 1);
  order.splice(toIndex, 0, moved!);
  const oldToNew = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  next.palette = order.map((oldIndex) => document.palette[oldIndex]!);
  remapPalette(next, (index) => oldToNew.get(index)!);
  return createDocumentPatch(document, next, "Reorder palette color");
}

export function addRegion(
  document: PixelDocument,
  region: Omit<Region, "id"> & { id?: string }
): DocumentPatch {
  assertRectInsideCanvas(region.bounds, document.canvas.width, document.canvas.height, "Region");
  getPixels(document, region.layerId, region.frameId);
  const next = structuredClone(document);
  const id = region.id ?? uniqueId("region", next.regions.map((candidate) => candidate.id));
  if (next.regions.some((candidate) => candidate.id === id)) throw new Error(`Region ID already exists: ${id}`);
  next.regions.push({ ...region, id });
  return createDocumentPatch(document, next, "Add region");
}

export function updateRegion(
  document: PixelDocument,
  regionId: string,
  update: Partial<Omit<Region, "id">>
): DocumentPatch {
  const next = structuredClone(document);
  const index = next.regions.findIndex((region) => region.id === regionId);
  if (index < 0) throw new Error(`Unknown region: ${regionId}`);
  const region = { ...next.regions[index]!, ...update };
  assertRectInsideCanvas(region.bounds, document.canvas.width, document.canvas.height, "Region");
  getPixels(document, region.layerId, region.frameId);
  next.regions[index] = region;
  return createDocumentPatch(document, next, "Update region");
}

export function removeRegion(document: PixelDocument, regionId: string): DocumentPatch {
  const next = structuredClone(document);
  next.regions = next.regions.filter((region) => region.id !== regionId);
  if (next.regions.length === document.regions.length) throw new Error(`Unknown region: ${regionId}`);
  return createDocumentPatch(document, next, "Remove region");
}

function assertCoordinate(document: PixelDocument, x: number, y: number): void {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= document.canvas.width ||
    y >= document.canvas.height
  ) {
    throw new RangeError(`Coordinate (${x}, ${y}) is outside the canvas.`);
  }
}

function assertPaletteIndex(document: PixelDocument, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= document.palette.length) {
    throw new RangeError(`Palette index ${index} is invalid.`);
  }
}

function assertPackedNormal(normal: number): void {
  if (!Number.isInteger(normal) || normal < 0 || normal > 0xffffff) {
    throw new RangeError("Packed normal must be an RGB integer between 0 and 16777215.");
  }
}

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new RangeError(`${label} must be an integer between 1 and 4096.`);
  }
}

function assertColor(color: string): void {
  if (!/^#[0-9a-fA-F]{8}$/.test(color)) throw new Error(`Invalid RGBA color: ${color}`);
}

function assertRectInsideCanvas(rect: Rect, width: number, height: number, label: string): void {
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x + rect.width > width ||
    rect.y + rect.height > height
  ) {
    throw new RangeError(`${label} must be a positive rectangle inside the canvas.`);
  }
}

function translateSelection(
  document: PixelDocument,
  selection: Selection,
  dx: number,
  dy: number
): Selection {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new RangeError("Selection movement must use whole pixels.");
  }
  const x = selection.x + dx;
  const y = selection.y + dy;
  if (
    x < 0 ||
    y < 0 ||
    x + selection.width > document.canvas.width ||
    y + selection.height > document.canvas.height
  ) {
    throw new RangeError("Selection cannot move outside the canvas.");
  }
  if (selection.type === "rect") return { ...selection, x, y };

  const indices = selection.indices.map((index) => {
    const targetX = index % document.canvas.width + dx;
    const targetY = Math.floor(index / document.canvas.width) + dy;
    if (
      targetX < 0 ||
      targetY < 0 ||
      targetX >= document.canvas.width ||
      targetY >= document.canvas.height
    ) {
      throw new RangeError("Selection cannot move outside the canvas.");
    }
    return targetY * document.canvas.width + targetX;
  });
  indices.sort((left, right) => left - right);
  return { ...selection, x, y, indices };
}

function computeDocumentContentBounds(document: PixelDocument): Rect {
  const occupied = new Array<number>(document.canvas.width * document.canvas.height).fill(0);
  for (const layer of document.layers) {
    for (const frame of document.frames) {
      const pixels = layer.frames[frame.id]!;
      for (let index = 0; index < pixels.length; index += 1) {
        if (pixels[index] !== document.transparentColorIndex) occupied[index] = 1;
      }
    }
  }
  return computeContentBounds(occupied, document.canvas.width, document.canvas.height, 0);
}

function canvasOffset(
  oldWidth: number,
  oldHeight: number,
  width: number,
  height: number,
  anchor: ResizeAnchor
): { x: number; y: number } {
  if (anchor === "top-left") return { x: 0, y: 0 };
  return {
    x: Math.floor((width - oldWidth) / 2),
    y: anchor === "bottom-center" ? height - oldHeight : Math.floor((height - oldHeight) / 2)
  };
}

function copyPixelsToCanvas(
  pixels: readonly number[],
  oldWidth: number,
  oldHeight: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  transparentColorIndex: number
): number[] {
  const output = Array.from({ length: width * height }, () => transparentColorIndex);
  for (let y = 0; y < oldHeight; y += 1) {
    for (let x = 0; x < oldWidth; x += 1) {
      const targetX = x + offsetX;
      const targetY = y + offsetY;
      if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
      output[targetY * width + targetX] = pixels[y * oldWidth + x]!;
    }
  }
  return output;
}

function translateRect(rect: Rect, x: number, y: number): Rect {
  return { x: rect.x + x, y: rect.y + y, width: rect.width, height: rect.height };
}

function intersectRect(rect: Rect, width: number, height: number): Rect | undefined {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width);
  const bottom = Math.min(height, rect.y + rect.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clipRect(rect: Rect, width: number, height: number): Rect {
  return (
    intersectRect(rect, width, height) ?? {
      x: clamp(rect.x, 0, width - 1),
      y: clamp(rect.y, 0, height - 1),
      width: 1,
      height: 1
    }
  );
}

function mapRect(rect: Rect, source: Rect, target: Rect): Rect {
  const rawLeft = target.x + Math.floor(((rect.x - source.x) * target.width) / source.width);
  const rawTop = target.y + Math.floor(((rect.y - source.y) * target.height) / source.height);
  const rawRight =
    target.x + Math.ceil(((rect.x + rect.width - source.x) * target.width) / source.width);
  const rawBottom =
    target.y + Math.ceil(((rect.y + rect.height - source.y) * target.height) / source.height);
  const left = clamp(rawLeft, target.x, target.x + target.width - 1);
  const top = clamp(rawTop, target.y, target.y + target.height - 1);
  const right = clamp(rawRight, left + 1, target.x + target.width);
  const bottom = clamp(rawBottom, top + 1, target.y + target.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function paletteRemovalMap(
  paletteLength: number,
  removedIndex: number,
  replacementIndex: number
): (index: number) => number {
  if (removedIndex < 0 || removedIndex >= paletteLength) throw new RangeError("Palette index is invalid.");
  const adjustedReplacement = replacementIndex > removedIndex ? replacementIndex - 1 : replacementIndex;
  return (index) => {
    if (index === removedIndex) return adjustedReplacement;
    return index > removedIndex ? index - 1 : index;
  };
}

function remapPalette(document: PixelDocument, map: (index: number) => number): void {
  for (const layer of document.layers) {
    for (const frame of document.frames) {
      layer.frames[frame.id] = layer.frames[frame.id]!.map(map);
    }
  }
  document.transparentColorIndex = map(document.transparentColorIndex);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function contains(selection: Selection, canvasWidth: number, x: number, y: number): boolean {
  if (x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height) {
    return false;
  }
  if (selection.type === "rect") return true;
  const target = y * canvasWidth + x;
  let low = 0;
  let high = selection.indices.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = selection.indices[middle]!;
    if (candidate === target) return true;
    if (candidate < target) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function forEachSelectedPixel(
  selection: Selection,
  canvasWidth: number,
  callback: (index: number, x: number, y: number) => void
): void {
  if (selection.type === "mask") {
    for (const index of selection.indices) callback(index, index % canvasWidth, Math.floor(index / canvasWidth));
    return;
  }
  forEachInRect(selection, canvasWidth, callback);
}

function forEachInRect(
  rect: Rect,
  canvasWidth: number,
  callback: (index: number, x: number, y: number) => void
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      callback(y * canvasWidth + x, x, y);
    }
  }
}

function boundsForChanges(changes: PixelChange[], canvasWidth: number): Rect {
  if (changes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const change of changes) {
    const x = change.index % canvasWidth;
    const y = Math.floor(change.index / canvasWidth);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function boundsForIndices(indices: readonly number[], canvasWidth: number): Rect | undefined {
  if (indices.length === 0) return undefined;
  const changes = indices.map((index) => ({ index, before: 0, after: 0 }));
  return boundsForChanges(changes, canvasWidth);
}

function hashOutsideSelection(pixels: readonly number[], width: number, selection: Selection): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < pixels.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (contains(selection, width, x, y)) continue;
    hash ^= pixels[index]! + (index & 0xff);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueId(prefix: string, existing: readonly string[]): string {
  if (!existing.includes(prefix)) return prefix;
  let counter = 2;
  while (existing.includes(`${prefix}-${counter}`)) counter += 1;
  return `${prefix}-${counter}`;
}

export type { Layer, PixelDocument, Rect, Region, Selection };
