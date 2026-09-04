import { compositeRgba, encodePng as encodeRgbaPng, resizeNearest } from "@editable-pixel/image-codec";
import type { PixelDocument } from "@editable-pixel/document";

import { renderLitRgba, renderNormalRgba, renderRgba, type LightSettings, type RenderOptions, type RenderedRgba } from "./index.js";

export async function renderPng(document: PixelDocument, options: RenderOptions = {}): Promise<Buffer> {
  return encodePng(renderRgba(document, options));
}

export async function renderNormalPng(document: PixelDocument, options: RenderOptions = {}): Promise<Buffer> {
  return encodePng(renderNormalRgba(document, options));
}

export async function renderNormalPreviewPng(
  document: PixelDocument,
  scale = 8,
  options: RenderOptions = {}
): Promise<Buffer> {
  assertScale(scale);
  return encodePng(renderNormalRgba(document, options), scale);
}

export async function renderLitPng(
  document: PixelDocument,
  light: LightSettings,
  options: RenderOptions = {}
): Promise<Buffer> {
  return encodePng(renderLitRgba(document, light, options));
}

export async function renderLitPreviewPng(
  document: PixelDocument,
  light: LightSettings,
  scale = 8,
  options: RenderOptions = {}
): Promise<Buffer> {
  assertScale(scale);
  return encodePng(renderLitRgba(document, light, options), scale);
}

async function encodePng(rendered: RenderedRgba, scale = 1): Promise<Buffer> {
  // Previews only ever scale by an integer factor, where nearest sampling is
  // exact pixel duplication — the pixel-art contract this renderer guarantees.
  const image = scale > 1
    ? resizeNearest(rendered, rendered.width * scale, rendered.height * scale)
    : rendered;
  return Buffer.from(await encodeRgbaPng(image));
}

export async function renderPreviewPng(
  document: PixelDocument,
  scale = 8,
  options: RenderOptions = {}
): Promise<Buffer> {
  assertScale(scale);
  return encodePng(renderRgba(document, options), scale);
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new RangeError("Preview scale must be an integer between 1 and 64.");
  }
}

export async function renderLayerPng(
  document: PixelDocument,
  layerId: string,
  frameId?: string
): Promise<Buffer> {
  return renderPng(document, { frameId, layerIds: [layerId] });
}

export async function renderSpriteSheet(document: PixelDocument): Promise<{
  png: Buffer;
  metadata: {
    width: number;
    height: number;
    frames: Array<{ id: string; x: number; y: number; width: number; height: number; durationMs: number }>;
  };
}> {
  const width = document.canvas.width * document.frames.length;
  const height = document.canvas.height;
  // Composite from RGBA directly instead of re-decoding per-frame PNGs; the
  // frames tile edge to edge, so a straight copy matches the old blend.
  const sheet = compositeRgba(
    width,
    height,
    document.frames.map((frame, index) => ({
      image: renderRgba(document, { frameId: frame.id }),
      left: index * document.canvas.width,
      top: 0
    }))
  );

  return {
    png: Buffer.from(await encodeRgbaPng(sheet)),
    metadata: {
      width,
      height,
      frames: document.frames.map((frame, index) => ({
        id: frame.id,
        x: index * document.canvas.width,
        y: 0,
        width: document.canvas.width,
        height: document.canvas.height,
        durationMs: frame.durationMs
      }))
    }
  };
}
