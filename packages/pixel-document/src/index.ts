import { Value } from "@sinclair/typebox/value";

import {
  PixelDocumentSchema,
  type ConversionOptions,
  type PixelDocument,
  type Rect,
  type Selection
} from "./schema.js";

export * from "./schema.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

interface LegacyPixelDocumentV0 {
  format: "pixel-document";
  version: 0;
  width: number;
  height: number;
  palette: string[];
  pixels: number[];
}

export function createPixelDocument(options: {
  id?: string;
  width: number;
  height: number;
  palette?: string[];
  pixels?: number[];
  alignment?: "center" | "bottom-center";
  conversion?: ConversionOptions;
  source?: PixelDocument["metadata"]["source"];
}): PixelDocument {
  const palette = options.palette ?? ["#00000000", "#000000ff"];
  const pixels = options.pixels ?? Array.from({ length: options.width * options.height }, () => 0);
  const fullCanvas: Rect = { x: 0, y: 0, width: options.width, height: options.height };
  const alignment = options.alignment ?? "center";
  const id = options.id ?? createDocumentId({
    width: options.width,
    height: options.height,
    palette,
    pixels,
    alignment,
    conversion: options.conversion
  });

  return {
    format: "pixel-document",
    version: 1,
    id,
    revision: 0,
    metadata: {
      createdBy: "editable-pixel",
      modifiedBy: "editable-pixel",
      ...(options.source ? { source: options.source } : {}),
      ...(options.conversion ? { conversion: options.conversion } : {})
    },
    canvas: { width: options.width, height: options.height },
    palette,
    transparentColorIndex: 0,
    frames: [{ id: "frame-1", name: "Frame 1", durationMs: 100 }],
    layers: [
      {
        id: "artwork",
        name: "Artwork",
        visible: true,
        opacity: 1,
        blendMode: "normal",
        frames: { "frame-1": pixels }
      }
    ],
    contentBox: fullCanvas,
    contentBounds: computeContentBounds(pixels, options.width, options.height, 0),
    alignment,
    pivot: {
      x: Math.floor(options.width / 2),
      y: alignment === "bottom-center" ? options.height - 1 : Math.floor(options.height / 2)
    },
    regions: []
  };
}

export function createDocumentId(value: unknown): string {
  const input = canonicalStringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const digest = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
  return `px-${digest}`;
}

export function computeContentBounds(
  pixels: readonly number[],
  width: number,
  height: number,
  transparentColorIndex: number
): Rect {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] === transparentColorIndex) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function validatePixelDocument(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!Value.Check(PixelDocumentSchema, input)) {
    for (const error of Value.Errors(PixelDocumentSchema, input)) {
      issues.push({ path: error.path || "/", message: error.message });
    }
    return { valid: false, issues };
  }

  const document = input as PixelDocument;
  const expectedPixelCount = document.canvas.width * document.canvas.height;
  const frameIds = new Set(document.frames.map((frame) => frame.id));
  const layerIds = new Set(document.layers.map((layer) => layer.id));
  const regionIds = new Set(document.regions.map((region) => region.id));

  if (frameIds.size !== document.frames.length) {
    issues.push({ path: "/frames", message: "Frame IDs must be unique." });
  }
  if (layerIds.size !== document.layers.length) {
    issues.push({ path: "/layers", message: "Layer IDs must be unique." });
  }
  if (regionIds.size !== document.regions.length) {
    issues.push({ path: "/regions", message: "Region IDs must be unique." });
  }
  if (document.transparentColorIndex >= document.palette.length) {
    issues.push({
      path: "/transparentColorIndex",
      message: "Transparent color index must reference the palette."
    });
  }

  for (const [layerIndex, layer] of document.layers.entries()) {
    for (const frameId of frameIds) {
      const pixels = layer.frames[frameId];
      if (!pixels) {
        issues.push({
          path: `/layers/${layerIndex}/frames/${frameId}`,
          message: "Every layer must contain pixels for every frame."
        });
        continue;
      }
      if (pixels.length !== expectedPixelCount) {
        issues.push({
          path: `/layers/${layerIndex}/frames/${frameId}`,
          message: `Expected ${expectedPixelCount} pixels, received ${pixels.length}.`
        });
      }
      const invalidIndex = pixels.findIndex((pixel) => pixel >= document.palette.length);
      if (invalidIndex >= 0) {
        issues.push({
          path: `/layers/${layerIndex}/frames/${frameId}/${invalidIndex}`,
          message: "Pixel index must reference the palette."
        });
      }
    }
    for (const frameId of Object.keys(layer.frames)) {
      if (!frameIds.has(frameId)) {
        issues.push({
          path: `/layers/${layerIndex}/frames/${frameId}`,
          message: "Layer references an unknown frame."
        });
      }
    }
  }

  validateRect("/contentBox", document.contentBox, document, issues);
  validateRect("/contentBounds", document.contentBounds, document, issues);
  if (document.pivot.x >= document.canvas.width || document.pivot.y >= document.canvas.height) {
    issues.push({ path: "/pivot", message: "Pivot must be inside the canvas." });
  }

  if (document.selection) {
    validateSelection(document.selection, document, layerIds, frameIds, issues);
  }
  for (const [regionIndex, region] of document.regions.entries()) {
    validateRect(`/regions/${regionIndex}/bounds`, region.bounds, document, issues);
    if (!layerIds.has(region.layerId)) {
      issues.push({ path: `/regions/${regionIndex}/layerId`, message: "Unknown layer." });
    }
    if (!frameIds.has(region.frameId)) {
      issues.push({ path: `/regions/${regionIndex}/frameId`, message: "Unknown frame." });
    }
  }

  return { valid: issues.length === 0, issues };
}

function validateRect(
  path: string,
  rect: Rect,
  document: PixelDocument,
  issues: ValidationIssue[]
): void {
  if (rect.x + rect.width > document.canvas.width || rect.y + rect.height > document.canvas.height) {
    issues.push({ path, message: "Rectangle must be inside the canvas." });
  }
}

function validateSelection(
  selection: Selection,
  document: PixelDocument,
  layerIds: ReadonlySet<string>,
  frameIds: ReadonlySet<string>,
  issues: ValidationIssue[]
): void {
  validateRect("/selection", selection, document, issues);
  if (selection.type === "mask") {
    if (selection.indices.some((index, position) => position > 0 && index <= selection.indices[position - 1]!)) {
      issues.push({ path: "/selection/indices", message: "Mask selection indices must be unique and strictly ascending." });
    }
    for (const index of selection.indices) {
      const x = index % document.canvas.width;
      const y = Math.floor(index / document.canvas.width);
      if (
        index >= document.canvas.width * document.canvas.height ||
        x < selection.x || x >= selection.x + selection.width ||
        y < selection.y || y >= selection.y + selection.height
      ) {
        issues.push({ path: "/selection/indices", message: "Mask selection indices must be inside its bounds and canvas." });
        break;
      }
    }
  }
  if (!layerIds.has(selection.layerId)) {
    issues.push({ path: "/selection/layerId", message: "Unknown layer." });
  }
  if (!frameIds.has(selection.frameId)) {
    issues.push({ path: "/selection/frameId", message: "Unknown frame." });
  }
}

export function assertPixelDocument(input: unknown): asserts input is PixelDocument {
  const result = validatePixelDocument(input);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Pixel Document:\n${detail}`);
  }
}

export function parsePixelDocument(input: string | unknown): PixelDocument {
  const decoded: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const migrated = migratePixelDocument(decoded);
  assertPixelDocument(migrated);
  return structuredClone(migrated);
}

export function serializePixelDocument(document: PixelDocument, pretty = true): string {
  assertPixelDocument(document);
  return canonicalStringify(document, pretty ? 2 : 0);
}

export function migratePixelDocument(input: unknown): unknown {
  if (!isLegacyV0(input)) return input;
  return createPixelDocument({
    width: input.width,
    height: input.height,
    palette: input.palette,
    pixels: input.pixels
  });
}

function isLegacyV0(input: unknown): input is LegacyPixelDocumentV0 {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return (
    value.format === "pixel-document" &&
    value.version === 0 &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    Array.isArray(value.palette) &&
    Array.isArray(value.pixels)
  );
}

function canonicalStringify(value: unknown, space = 0): string {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)])
  );
}
