import type { PixelDocument } from "@editable-pixel/document";
import sharp from "sharp";

import { renderRgba, type RenderOptions } from "./index.js";

export async function renderPng(document: PixelDocument, options: RenderOptions = {}): Promise<Buffer> {
  const rendered = renderRgba(document, options);
  return sharp(Buffer.from(rendered.data), {
    raw: { width: rendered.width, height: rendered.height, channels: 4 }
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

export async function renderPreviewPng(
  document: PixelDocument,
  scale = 8,
  options: RenderOptions = {}
): Promise<Buffer> {
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new RangeError("Preview scale must be an integer between 1 and 64.");
  }
  const rendered = renderRgba(document, options);
  return sharp(Buffer.from(rendered.data), {
    raw: { width: rendered.width, height: rendered.height, channels: 4 }
  })
    .resize(rendered.width * scale, rendered.height * scale, { kernel: "nearest" })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
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
  const frameBuffers = await Promise.all(document.frames.map((frame) => renderPng(document, { frameId: frame.id })));
  const png = await sharp({
    create: {
      width: document.canvas.width * document.frames.length,
      height: document.canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(
      frameBuffers.map((input, index) => ({
        input,
        left: index * document.canvas.width,
        top: 0
      }))
    )
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();

  return {
    png,
    metadata: {
      width: document.canvas.width * document.frames.length,
      height: document.canvas.height,
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
