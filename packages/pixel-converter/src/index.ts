import { createHash } from "node:crypto";

import {
  assertPixelDocument,
  createPixelDocument,
  type PixelDocument,
  type Rect
} from "@editable-pixel/document";
import sharp from "sharp";

export type ConverterInput = Buffer | Uint8Array;
export type Dithering = "none" | "floyd-steinberg";
export type BackgroundMode = "alpha" | "solid" | "local-removal";

export interface ConvertOptions {
  canvasWidth: number;
  canvasHeight: number;
  colorCount?: number;
  palette?: string[];
  alignment?: "center" | "bottom-center";
  contentScale?: number;
  contentBox?: Rect;
  dithering?: Dithering;
  background?: BackgroundMode;
  solidBackground?: string;
  backgroundTolerance?: number;
  alphaThreshold?: number;
  backgroundRemover?: (input: Buffer) => Promise<Buffer>;
}

export interface InputMetadata {
  name?: string;
  mimeType?: string;
}

export interface ConversionResult {
  document: PixelDocument;
  original: { width: number; height: number; format?: string };
  normalized: { contentBox: Rect; contentBounds: Rect };
}

interface ResolvedOptions {
  canvasWidth: number;
  canvasHeight: number;
  colorCount: number;
  palette?: string[];
  alignment: "center" | "bottom-center";
  contentScale: number;
  contentBox: Rect;
  dithering: Dithering;
  background: BackgroundMode;
  solidBackground?: string;
  backgroundTolerance: number;
  alphaThreshold: number;
  backgroundRemover?: (input: Buffer) => Promise<Buffer>;
}

interface NormalizedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  original: ConversionResult["original"];
  contentBox: Rect;
}

interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  original: ConversionResult["original"];
  bounds?: Rect;
}

interface GroupPlacement {
  x: number;
  y: number;
}

interface WeightedColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

export async function convertImage(
  input: ConverterInput,
  options: ConvertOptions,
  metadata: InputMetadata = {}
): Promise<ConversionResult> {
  const resolved = resolveOptions(options);
  const source = Buffer.from(input);
  const normalized = (await normalizeImages([source], resolved))[0]!;
  const palette = resolved.palette ?? createPalette([normalized], resolved.colorCount);
  return createResult(source, normalized, palette, resolved, metadata);
}

export async function convertBatch(
  inputs: Array<{ input: ConverterInput; metadata?: InputMetadata }>,
  options: ConvertOptions
): Promise<ConversionResult[]> {
  if (inputs.length === 0) throw new Error("Batch conversion needs at least one image.");
  const resolved = resolveOptions(options);
  const sources = inputs.map(({ input }) => Buffer.from(input));
  const normalized = await normalizeImages(sources, resolved);
  const palette = resolved.palette ?? createPalette(normalized, resolved.colorCount);
  return normalized.map((image, index) =>
    createResult(sources[index]!, image, palette, resolved, inputs[index]!.metadata ?? {})
  );
}

function resolveOptions(options: ConvertOptions): ResolvedOptions {
  assertDimension(options.canvasWidth, "Canvas width");
  assertDimension(options.canvasHeight, "Canvas height");
  const colorCount = options.colorCount ?? options.palette?.length ?? 16;
  if (!Number.isInteger(colorCount) || colorCount < 1 || colorCount > 256) {
    throw new RangeError("Color count must be an integer between 1 and 256.");
  }
  const contentScale = options.contentScale ?? 0.8;
  if (!Number.isFinite(contentScale) || contentScale <= 0 || contentScale > 1) {
    throw new RangeError("Content scale must be greater than 0 and at most 1.");
  }
  const alignment = options.alignment ?? "center";
  const contentBox = options.contentBox ?? defaultContentBox(
    options.canvasWidth,
    options.canvasHeight,
    contentScale,
    alignment
  );
  assertRect(contentBox, options.canvasWidth, options.canvasHeight, "Content box");
  const palette = options.palette?.map(normalizeColor);
  if (palette) {
    if (palette.length === 0 || palette.length > 256) {
      throw new RangeError("A fixed palette must contain between 1 and 256 colors.");
    }
    if (palette.length === 256 && !palette.some((color) => color.slice(7) === "00")) {
      throw new RangeError("A 256-color fixed palette must include a transparent color.");
    }
    if (new Set(palette).size !== palette.length) throw new Error("Fixed palette colors must be unique.");
  }
  const backgroundTolerance = options.backgroundTolerance ?? 24;
  if (!Number.isFinite(backgroundTolerance) || backgroundTolerance < 0 || backgroundTolerance > 441) {
    throw new RangeError("Background tolerance must be between 0 and 441.");
  }
  const alphaThreshold = options.alphaThreshold ?? 128;
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
    throw new RangeError("Alpha threshold must be an integer between 0 and 255.");
  }
  return {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    colorCount,
    ...(palette ? { palette } : {}),
    alignment,
    contentScale,
    contentBox,
    dithering: options.dithering ?? "none",
    background: options.background ?? "alpha",
    ...(options.solidBackground ? { solidBackground: normalizeColor(options.solidBackground) } : {}),
    backgroundTolerance,
    alphaThreshold,
    ...(options.backgroundRemover ? { backgroundRemover: options.backgroundRemover } : {})
  };
}

async function decodeImage(input: Buffer, options: ResolvedOptions): Promise<DecodedImage> {
  let source = input;
  if (options.background === "local-removal") {
    if (!options.backgroundRemover) {
      throw new Error("Local background removal was requested but no background remover is configured.");
    }
    source = await options.backgroundRemover(input);
  }
  const decoder = sharp(source);
  const sourceMetadata = await decoder.metadata();
  const decoded = await decoder.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = new Uint8ClampedArray(decoded.data);
  if (options.background === "solid") removeSolidBackground(data, options);
  thresholdAlpha(data, options.alphaThreshold);
  const bounds = alphaBounds(data, decoded.info.width, decoded.info.height);
  return {
    data,
    width: decoded.info.width,
    height: decoded.info.height,
    original: {
      width: decoded.info.width,
      height: decoded.info.height,
      ...(sourceMetadata.format ? { format: sourceMetadata.format } : {})
    },
    ...(bounds ? { bounds } : {})
  };
}

async function normalizeImages(inputs: Buffer[], options: ResolvedOptions): Promise<NormalizedImage[]> {
  const decoded = await Promise.all(inputs.map((input) => decodeImage(input, options)));
  const groupWidth = Math.max(...decoded.map((image) => image.width));
  const groupHeight = Math.max(...decoded.map((image) => image.height));
  const placements = decoded.map((image): GroupPlacement => ({
    x: Math.floor((groupWidth - image.width) / 2),
    y: options.alignment === "bottom-center"
      ? groupHeight - image.height
      : Math.floor((groupHeight - image.height) / 2)
  }));
  const groupBounds = unionRects(decoded.flatMap((image, index) => {
    if (!image.bounds) return [];
    const placement = placements[index]!;
    return [{
      x: image.bounds.x + placement.x,
      y: image.bounds.y + placement.y,
      width: image.bounds.width,
      height: image.bounds.height
    }];
  }));
  return Promise.all(decoded.map((image, index) =>
    normalizeDecodedImage(image, placements[index]!, groupBounds, options)
  ));
}

async function normalizeDecodedImage(
  image: DecodedImage,
  placement: GroupPlacement,
  groupBounds: Rect | undefined,
  options: ResolvedOptions
): Promise<NormalizedImage> {
  const canvas = new Uint8ClampedArray(options.canvasWidth * options.canvasHeight * 4);
  if (groupBounds) {
    const target = containRect(groupBounds.width, groupBounds.height, options.contentBox, options.alignment);
    const groupCrop = cropToGroupBounds(image, placement, groupBounds);
    const extracted = await sharp(Buffer.from(groupCrop), {
      raw: { width: groupBounds.width, height: groupBounds.height, channels: 4 }
    })
      .resize(target.width, target.height, { kernel: "nearest", fit: "fill" })
      .raw()
      .toBuffer();
    blitRgba(canvas, options.canvasWidth, new Uint8ClampedArray(extracted), target);
  }
  return {
    data: canvas,
    width: options.canvasWidth,
    height: options.canvasHeight,
    original: image.original,
    contentBox: options.contentBox
  };
}

function cropToGroupBounds(image: DecodedImage, placement: GroupPlacement, groupBounds: Rect): Uint8ClampedArray {
  const crop = new Uint8ClampedArray(groupBounds.width * groupBounds.height * 4);
  const imageLeft = placement.x;
  const imageTop = placement.y;
  const imageRight = imageLeft + image.width;
  const imageBottom = imageTop + image.height;
  const copyLeft = Math.max(groupBounds.x, imageLeft);
  const copyTop = Math.max(groupBounds.y, imageTop);
  const copyRight = Math.min(groupBounds.x + groupBounds.width, imageRight);
  const copyBottom = Math.min(groupBounds.y + groupBounds.height, imageBottom);
  if (copyLeft >= copyRight || copyTop >= copyBottom) return crop;

  const copyWidth = copyRight - copyLeft;
  for (let y = copyTop; y < copyBottom; y += 1) {
    const sourceX = copyLeft - imageLeft;
    const sourceY = y - imageTop;
    const targetX = copyLeft - groupBounds.x;
    const targetY = y - groupBounds.y;
    const sourceStart = (sourceY * image.width + sourceX) * 4;
    const targetStart = (targetY * groupBounds.width + targetX) * 4;
    crop.set(image.data.subarray(sourceStart, sourceStart + copyWidth * 4), targetStart);
  }
  return crop;
}

function unionRects(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createResult(
  source: Buffer,
  image: NormalizedImage,
  rawPalette: string[],
  options: ResolvedOptions,
  metadata: InputMetadata
): ConversionResult {
  const palette = ensureTransparentPalette(rawPalette);
  if (palette.length > options.colorCount && !options.palette) palette.length = options.colorCount;
  const pixels = mapPixels(image, palette, options.dithering, options.alphaThreshold);
  const document = createPixelDocument({
    width: options.canvasWidth,
    height: options.canvasHeight,
    palette,
    pixels,
    alignment: options.alignment,
    conversion: {
      canvasWidth: options.canvasWidth,
      canvasHeight: options.canvasHeight,
      colorCount: palette.length,
      alignment: options.alignment,
      contentScale: options.contentScale,
      dithering: options.dithering,
      background: options.background
    },
    source: {
      name: metadata.name ?? "image",
      mimeType: metadata.mimeType ?? mimeTypeForFormat(image.original.format),
      digest: createHash("sha256").update(source).digest("hex")
    }
  });
  document.contentBox = { ...image.contentBox };
  document.pivot = {
    x: image.contentBox.x + Math.floor(image.contentBox.width / 2),
    y:
      options.alignment === "bottom-center"
        ? image.contentBox.y + image.contentBox.height - 1
        : image.contentBox.y + Math.floor(image.contentBox.height / 2)
  };
  assertPixelDocument(document);
  return {
    document,
    original: image.original,
    normalized: { contentBox: document.contentBox, contentBounds: document.contentBounds }
  };
}

function createPalette(images: NormalizedImage[], colorCount: number): string[] {
  if (colorCount === 1) return ["#00000000"];
  const counts = new Map<string, WeightedColor>();
  for (const image of images) {
    for (let offset = 0; offset < image.data.length; offset += 4) {
      if (image.data[offset + 3] === 0) continue;
      const r = image.data[offset]!;
      const g = image.data[offset + 1]!;
      const b = image.data[offset + 2]!;
      const key = `${r},${g},${b}`;
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { r, g, b, count: 1 });
    }
  }
  if (counts.size === 0) return ["#00000000"];
  const opaque = medianCut([...counts.values()], colorCount - 1).map(toOpaqueHex);
  return ["#00000000", ...opaque];
}

function medianCut(colors: WeightedColor[], limit: number): WeightedColor[] {
  const boxes: WeightedColor[][] = [colors];
  while (boxes.length < limit) {
    let selected = -1;
    let selectedScore = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index]!;
      if (box.length < 2) continue;
      const score = colorRange(box) * box.reduce((sum, color) => sum + color.count, 0);
      if (score > selectedScore) {
        selected = index;
        selectedScore = score;
      }
    }
    if (selected < 0) break;
    const box = boxes.splice(selected, 1)[0]!;
    const channel = widestChannel(box);
    box.sort((left, right) => left[channel] - right[channel] || left.r - right.r || left.g - right.g || left.b - right.b);
    const total = box.reduce((sum, color) => sum + color.count, 0);
    let cumulative = 0;
    let split = 1;
    for (; split < box.length; split += 1) {
      cumulative += box[split - 1]!.count;
      if (cumulative >= total / 2) break;
    }
    split = Math.min(split, box.length - 1);
    boxes.push(box.slice(0, split), box.slice(split));
  }
  return boxes.map(weightedAverage).sort((left, right) =>
    left.r - right.r || left.g - right.g || left.b - right.b
  );
}

function mapPixels(
  image: NormalizedImage,
  palette: string[],
  dithering: Dithering,
  alphaThreshold: number
): number[] {
  const colors = palette.map(parseColor);
  const data = new Float64Array(image.data);
  const pixels = new Array<number>(image.width * image.height).fill(0);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x;
      const offset = pixelIndex * 4;
      if (data[offset + 3]! < alphaThreshold) continue;
      const nearest = nearestColor(data[offset]!, data[offset + 1]!, data[offset + 2]!, colors);
      pixels[pixelIndex] = nearest;
      if (dithering === "floyd-steinberg") {
        const target = colors[nearest]!;
        diffuse(data, image.width, image.height, x + 1, y, data[offset]! - target[0], data[offset + 1]! - target[1], data[offset + 2]! - target[2], 7 / 16);
        diffuse(data, image.width, image.height, x - 1, y + 1, data[offset]! - target[0], data[offset + 1]! - target[1], data[offset + 2]! - target[2], 3 / 16);
        diffuse(data, image.width, image.height, x, y + 1, data[offset]! - target[0], data[offset + 1]! - target[1], data[offset + 2]! - target[2], 5 / 16);
        diffuse(data, image.width, image.height, x + 1, y + 1, data[offset]! - target[0], data[offset + 1]! - target[1], data[offset + 2]! - target[2], 1 / 16);
      }
    }
  }
  return pixels;
}

function removeSolidBackground(data: Uint8ClampedArray, options: ResolvedOptions): void {
  const background = options.solidBackground
    ? parseColor(options.solidBackground)
    : [data[0]!, data[1]!, data[2]!, data[3]!] as [number, number, number, number];
  for (let offset = 0; offset < data.length; offset += 4) {
    const distance = Math.hypot(
      data[offset]! - background[0],
      data[offset + 1]! - background[1],
      data[offset + 2]! - background[2]
    );
    if (distance <= options.backgroundTolerance) data[offset + 3] = 0;
  }
}

function thresholdAlpha(data: Uint8ClampedArray, threshold: number): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = data[offset + 3]! < threshold ? 0 : 255;
  }
}

function alphaBounds(data: Uint8ClampedArray, width: number, height: number): Rect | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? undefined : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function containRect(
  width: number,
  height: number,
  box: Rect,
  alignment: "center" | "bottom-center"
): Rect {
  const scale = Math.min(box.width / width, box.height / height);
  const targetWidth = Math.max(1, Math.min(box.width, Math.round(width * scale)));
  const targetHeight = Math.max(1, Math.min(box.height, Math.round(height * scale)));
  return {
    x: box.x + Math.floor((box.width - targetWidth) / 2),
    y: alignment === "bottom-center" ? box.y + box.height - targetHeight : box.y + Math.floor((box.height - targetHeight) / 2),
    width: targetWidth,
    height: targetHeight
  };
}

function blitRgba(target: Uint8ClampedArray, targetWidth: number, input: Uint8ClampedArray, rect: Rect): void {
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = y * rect.width * 4;
    const targetStart = ((rect.y + y) * targetWidth + rect.x) * 4;
    target.set(input.subarray(sourceStart, sourceStart + rect.width * 4), targetStart);
  }
}

function defaultContentBox(
  width: number,
  height: number,
  scale: number,
  alignment: "center" | "bottom-center"
): Rect {
  const boxWidth = Math.max(1, Math.min(width, Math.round(width * scale)));
  const boxHeight = Math.max(1, Math.min(height, Math.round(height * scale)));
  return {
    x: Math.floor((width - boxWidth) / 2),
    y: alignment === "bottom-center" ? height - boxHeight : Math.floor((height - boxHeight) / 2),
    width: boxWidth,
    height: boxHeight
  };
}

function ensureTransparentPalette(palette: string[]): string[] {
  const normalized = palette.map(normalizeColor);
  const transparentIndex = normalized.findIndex((color) => color.slice(7) === "00");
  if (transparentIndex < 0) return ["#00000000", ...normalized];
  const [transparent] = normalized.splice(transparentIndex, 1);
  return [transparent!, ...normalized];
}

function normalizeColor(color: string): string {
  const expanded = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}ff` : color;
  if (!/^#[0-9a-fA-F]{8}$/.test(expanded)) throw new Error(`Invalid RGBA color: ${color}`);
  return expanded.toLowerCase();
}

function parseColor(color: string): [number, number, number, number] {
  const normalized = normalizeColor(color);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    Number.parseInt(normalized.slice(7, 9), 16)
  ];
}

function nearestColor(r: number, g: number, b: number, colors: Array<[number, number, number, number]>): number {
  let best = colors.length > 1 ? 1 : 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = colors.length > 1 ? 1 : 0; index < colors.length; index += 1) {
    const color = colors[index]!;
    const distance = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function diffuse(
  data: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  errorR: number,
  errorG: number,
  errorB: number,
  weight: number
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  if (data[offset + 3] === 0) return;
  data[offset] = clamp(data[offset]! + errorR * weight, 0, 255);
  data[offset + 1] = clamp(data[offset + 1]! + errorG * weight, 0, 255);
  data[offset + 2] = clamp(data[offset + 2]! + errorB * weight, 0, 255);
}

function widestChannel(colors: WeightedColor[]): "r" | "g" | "b" {
  const ranges = {
    r: channelRange(colors, "r"),
    g: channelRange(colors, "g"),
    b: channelRange(colors, "b")
  };
  if (ranges.g > ranges.r && ranges.g >= ranges.b) return "g";
  if (ranges.b > ranges.r && ranges.b > ranges.g) return "b";
  return "r";
}

function colorRange(colors: WeightedColor[]): number {
  return Math.max(channelRange(colors, "r"), channelRange(colors, "g"), channelRange(colors, "b"));
}

function channelRange(colors: WeightedColor[], channel: "r" | "g" | "b"): number {
  let minimum = 255;
  let maximum = 0;
  for (const color of colors) {
    minimum = Math.min(minimum, color[channel]);
    maximum = Math.max(maximum, color[channel]);
  }
  return maximum - minimum;
}

function weightedAverage(colors: WeightedColor[]): WeightedColor {
  const count = colors.reduce((sum, color) => sum + color.count, 0);
  return {
    r: Math.round(colors.reduce((sum, color) => sum + color.r * color.count, 0) / count),
    g: Math.round(colors.reduce((sum, color) => sum + color.g * color.count, 0) / count),
    b: Math.round(colors.reduce((sum, color) => sum + color.b * color.count, 0) / count),
    count
  };
}

function toOpaqueHex(color: WeightedColor): string {
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}ff`;
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function mimeTypeForFormat(format?: string): string {
  if (format === "jpg" || format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function assertDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 4096) {
    throw new RangeError(`${label} must be an integer between 1 and 4096.`);
  }
}

function assertRect(rect: Rect, width: number, height: number, label: string): void {
  if (rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || rect.x + rect.width > width || rect.y + rect.height > height) {
    throw new RangeError(`${label} must be inside the canvas.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
