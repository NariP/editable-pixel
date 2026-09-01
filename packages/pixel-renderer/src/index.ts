import { DEFAULT_FRAME_LIGHTING, NEUTRAL_NORMAL, resolveFrameLighting, type FrameLighting, type Layer, type PixelDocument } from "@editable-pixel/document";
import * as gifencNamespace from "gifenc";

const gifenc = typeof gifencNamespace.GIFEncoder === "function"
  ? gifencNamespace
  : gifencNamespace.default;
const { GIFEncoder, applyPalette, quantize } = gifenc;

export interface RenderOptions {
  frameId?: string;
  layerIds?: string[];
}

export interface RenderedRgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type LightSettings = FrameLighting;

export interface AnimationRenderOptions {
  frameIds?: string[];
  scale?: number;
  map?: "color" | "normal" | "lit";
  loop?: boolean;
  layerIds?: string[];
}

export function renderAnimationGif(document: PixelDocument, options: AnimationRenderOptions = {}): Uint8Array {
  const frameIds = options.frameIds ?? document.frames.map((frame) => frame.id);
  const frames = frameIds.map((frameId) => {
    const frame = document.frames.find((candidate) => candidate.id === frameId);
    if (!frame) throw new Error(`Frame ${frameId} does not exist.`);
    return frame;
  });
  if (frames.length === 0) throw new Error("Animation requires at least one frame.");
  const scale = options.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new RangeError("Animation scale must be an integer between 1 and 64.");
  }
  const width = document.canvas.width * scale;
  const height = document.canvas.height * scale;
  const encoder = GIFEncoder();
  for (const frame of frames) {
    const renderOptions: RenderOptions = {
      frameId: frame.id,
      ...(options.layerIds ? { layerIds: options.layerIds } : {})
    };
    const rendered = options.map === "normal"
      ? renderNormalRgba(document, renderOptions)
      : options.map === "lit"
        ? renderLitRgba(document, resolveFrameLighting(document, frameIds, frame.id), renderOptions)
        : renderRgba(document, renderOptions);
    const rgba = scale === 1
      ? rendered.data
      : nearestNeighborScale(rendered.data, rendered.width, rendered.height, scale);
    const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
    const indices = applyPalette(rgba, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => (color[3] ?? 255) === 0);
    encoder.writeFrame(indices, width, height, {
      palette,
      delay: frame.durationMs,
      repeat: options.loop === false ? -1 : 0,
      dispose: transparentIndex >= 0 ? 2 : 1,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {})
    });
  }
  encoder.finish();
  return encoder.bytes();
}

export function renderRgba(document: PixelDocument, options: RenderOptions = {}): RenderedRgba {
  const frameId = options.frameId ?? document.frames[0]!.id;
  const selectedLayers = options.layerIds
    ? document.layers.filter((layer) => options.layerIds!.includes(layer.id))
    : document.layers;
  const data = new Uint8ClampedArray(document.canvas.width * document.canvas.height * 4);

  for (const layer of selectedLayers) {
    if (!layer.visible || layer.opacity === 0) continue;
    compositeLayer(data, document, layer, frameId);
  }

  return { width: document.canvas.width, height: document.canvas.height, data };
}

export function renderNormalRgba(document: PixelDocument, options: RenderOptions = {}): RenderedRgba {
  const frameId = options.frameId ?? document.frames[0]!.id;
  const selectedLayers = options.layerIds
    ? document.layers.filter((layer) => options.layerIds!.includes(layer.id))
    : document.layers;
  const data = new Uint8ClampedArray(document.canvas.width * document.canvas.height * 4);

  for (const layer of selectedLayers) {
    if (!layer.visible || layer.opacity === 0) continue;
    compositeNormalLayer(data, document, layer, frameId);
  }
  return { width: document.canvas.width, height: document.canvas.height, data };
}

export function renderLitRgba(
  document: PixelDocument,
  light: LightSettings,
  options: RenderOptions = {}
): RenderedRgba {
  const color = renderRgba(document, options);
  const normal = renderNormalRgba(document, options);
  const data = new Uint8ClampedArray(color.data);
  const lightX = clamp(light.x, -1, 2) * color.width;
  const lightY = clamp(light.y, -1, 2) * color.height;
  const lightZ = Math.max(0.05, light.height) * Math.max(color.width, color.height);
  const ambient = clamp(light.ambient, 0, 1);
  const intensity = Math.max(0, light.intensity);
  const shading = light.shading ?? DEFAULT_FRAME_LIGHTING.shading;
  const toonSteps = Math.round(clamp(light.toonSteps ?? DEFAULT_FRAME_LIGHTING.toonSteps, 3, 6));

  for (let index = 0; index < color.width * color.height; index += 1) {
    const offset = index * 4;
    if (data[offset + 3] === 0) continue;
    const x = index % color.width;
    const y = Math.floor(index / color.width);
    const [nx, ny, nz] = rgbToNormal(
      normal.data[offset]!,
      normal.data[offset + 1]!,
      normal.data[offset + 2]!
    );
    const lx = lightX - (x + 0.5);
    const ly = (y + 0.5) - lightY;
    const length = Math.hypot(lx, ly, lightZ) || 1;
    const diffuse = Math.max(0, nx * (lx / length) + ny * (ly / length) + nz * (lightZ / length));
    const amount = clamp(ambient + diffuse * intensity, 0, 1.5);
    if (shading === "toon-palette") {
      // Toon needs a tighter exposure range than Smooth lighting. At 1.25,
      // ordinary 50% strength / 55% ambient settings reach a highlight even
      // with three tones, while stronger lights still retain headroom.
      const rampIndex = Math.round(clamp(amount / 1.25, 0, 1) * (toonSteps - 1));
      const [red, green, blue] = toonPaletteRamp(
        [data[offset]!, data[offset + 1]!, data[offset + 2]!],
        rampIndex,
        toonSteps
      );
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
    } else {
      data[offset] = Math.round(data[offset]! * amount);
      data[offset + 1] = Math.round(data[offset + 1]! * amount);
      data[offset + 2] = Math.round(data[offset + 2]! * amount);
    }
  }
  return { width: color.width, height: color.height, data };
}

/**
 * Builds a compact cool-shadow / base / warm-highlight ramp for one source
 * color. The base slot is always the untouched source color so flat artwork
 * remains authored in its original palette while normals choose discrete
 * lighting bands around it.
 */
function toonPaletteRamp(
  base: [number, number, number],
  rampIndex: number,
  steps: number
): [number, number, number] {
  const baseIndex = Math.floor(steps / 2);
  if (rampIndex === baseIndex) return base;
  if (rampIndex < baseIndex) {
    const depth = (baseIndex - rampIndex) / baseIndex;
    return mixRgb(base, [8, 14, 28], 0.68 * depth);
  }
  const highlightSteps = Math.max(1, steps - 1 - baseIndex);
  const lift = (rampIndex - baseIndex) / highlightSteps;
  return mixRgb(base, [255, 244, 218], 0.48 * lift);
}

function mixRgb(
  from: [number, number, number],
  to: [number, number, number],
  amount: number
): [number, number, number] {
  const mix = (start: number, end: number) => Math.round(start + (end - start) * amount);
  return [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
}

function compositeLayer(
  target: Uint8ClampedArray,
  document: PixelDocument,
  layer: Layer,
  frameId: string
): void {
  const pixels = layer.frames[frameId];
  if (!pixels) throw new Error(`Layer ${layer.id} does not contain frame ${frameId}.`);

  for (let index = 0; index < pixels.length; index += 1) {
    const source = parseRgba(document.palette[pixels[index]!]!);
    const offset = index * 4;
    const sourceAlpha = (source[3] / 255) * layer.opacity;
    const targetAlpha = target[offset + 3]! / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) continue;

    for (let channel = 0; channel < 3; channel += 1) {
      const value =
        (source[channel]! * sourceAlpha + target[offset + channel]! * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha;
      target[offset + channel] = Math.round(value);
    }
    target[offset + 3] = Math.round(outputAlpha * 255);
  }
}

function compositeNormalLayer(
  target: Uint8ClampedArray,
  document: PixelDocument,
  layer: Layer,
  frameId: string
): void {
  const pixels = layer.frames[frameId];
  if (!pixels) throw new Error(`Layer ${layer.id} does not contain frame ${frameId}.`);
  const normals = layer.normalFrames?.[frameId];

  for (let index = 0; index < pixels.length; index += 1) {
    const color = parseRgba(document.palette[pixels[index]!]!);
    const sourceAlpha = (color[3] / 255) * layer.opacity;
    if (sourceAlpha === 0) continue;
    const packed = normals?.[index] ?? NEUTRAL_NORMAL;
    const source = packedNormalToRgb(packed);
    const offset = index * 4;
    const targetAlpha = target[offset + 3]! / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      target[offset + channel] = Math.round(
        (source[channel]! * sourceAlpha + target[offset + channel]! * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha
      );
    }
    target[offset + 3] = Math.round(outputAlpha * 255);
  }
}

function nearestNeighborScale(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number
): Uint8ClampedArray {
  const outputWidth = width * scale;
  const output = new Uint8ClampedArray(outputWidth * height * scale * 4);
  for (let y = 0; y < height * scale; y += 1) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.floor(x / scale);
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const outputOffset = (y * outputWidth + x) * 4;
      output[outputOffset] = source[sourceOffset]!;
      output[outputOffset + 1] = source[sourceOffset + 1]!;
      output[outputOffset + 2] = source[sourceOffset + 2]!;
      output[outputOffset + 3] = source[sourceOffset + 3]!;
    }
  }
  return output;
}

export function normalVectorToPacked(x: number, y: number, z?: number): number {
  let nx = clamp(x, -1, 1);
  let ny = clamp(y, -1, 1);
  let nz = z === undefined ? Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) : clamp(z, 0, 1);
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  const red = Math.round((nx * 0.5 + 0.5) * 255);
  const green = Math.round((ny * 0.5 + 0.5) * 255);
  const blue = Math.round((nz * 0.5 + 0.5) * 255);
  return (red << 16) | (green << 8) | blue;
}

export function packedNormalToVector(packed: number): [number, number, number] {
  const [red, green, blue] = packedNormalToRgb(packed);
  return rgbToNormal(red, green, blue);
}

export function packedNormalToRgb(packed: number): [number, number, number] {
  return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff];
}

function rgbToNormal(red: number, green: number, blue: number): [number, number, number] {
  const x = red / 127.5 - 1;
  const y = green / 127.5 - 1;
  const z = blue / 127.5 - 1;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function parseRgba(color: string): [number, number, number, number] {
  if (!/^#[0-9a-fA-F]{8}$/.test(color)) throw new Error(`Invalid RGBA color: ${color}`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    Number.parseInt(color.slice(7, 9), 16)
  ];
}

export function rgbaToImageData(rendered: RenderedRgba): ImageData {
  const data = new Uint8ClampedArray(rendered.data.length);
  data.set(rendered.data);
  return new ImageData(data, rendered.width, rendered.height);
}
