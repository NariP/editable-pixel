import { serializePixelDocument, type PixelDocument } from "@editable-pixel/document";
import { renderRgba } from "@editable-pixel/renderer";

export function downloadDocument(pixelDocument: PixelDocument, compact = false): void {
  downloadBlob(
    new Blob([serializePixelDocument(pixelDocument, !compact)], { type: "application/json" }),
    `${safeName(pixelDocument.id)}${compact ? ".compact" : ""}.pixel.json`
  );
}

export async function downloadPng(
  pixelDocument: PixelDocument,
  options: { frameId?: string; layerIds?: string[]; scale?: number; name?: string } = {}
): Promise<void> {
  const rendered = renderRgba(pixelDocument, options);
  const scale = options.scale ?? 1;
  const source = globalThis.document.createElement("canvas");
  source.width = rendered.width;
  source.height = rendered.height;
  const sourceContext = source.getContext("2d")!;
  const pixels = new Uint8ClampedArray(rendered.data.length);
  pixels.set(rendered.data);
  sourceContext.putImageData(new ImageData(pixels, rendered.width, rendered.height), 0, 0);
  const output = globalThis.document.createElement("canvas");
  output.width = rendered.width * scale;
  output.height = rendered.height * scale;
  const context = output.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, output.width, output.height);
  const blob = await canvasBlob(output);
  downloadBlob(blob, options.name ?? `${safeName(pixelDocument.id)}${scale > 1 ? `-${scale}x` : ""}.png`);
}

export async function downloadLayerPngs(pixelDocument: PixelDocument, frameId: string, scale = 1): Promise<void> {
  for (const layer of pixelDocument.layers) {
    await downloadPng(pixelDocument, {
      frameId,
      layerIds: [layer.id],
      scale,
      name: `${safeName(pixelDocument.id)}-${safeName(layer.name)}${scaleSuffix(scale)}.png`
    });
  }
}

export async function downloadFramePngs(pixelDocument: PixelDocument, scale = 1): Promise<void> {
  for (const frame of pixelDocument.frames) {
    await downloadPng(pixelDocument, {
      frameId: frame.id,
      scale,
      name: `${safeName(pixelDocument.id)}-${safeName(frame.name)}${scaleSuffix(scale)}.png`
    });
  }
}

export async function downloadSpriteSheet(pixelDocument: PixelDocument, scale = 1): Promise<void> {
  const source = globalThis.document.createElement("canvas");
  source.width = pixelDocument.canvas.width * pixelDocument.frames.length;
  source.height = pixelDocument.canvas.height;
  const sourceContext = source.getContext("2d")!;
  for (const [index, frame] of pixelDocument.frames.entries()) {
    const rendered = renderRgba(pixelDocument, { frameId: frame.id });
    const pixels = new Uint8ClampedArray(rendered.data.length);
    pixels.set(rendered.data);
    sourceContext.putImageData(new ImageData(pixels, rendered.width, rendered.height), index * rendered.width, 0);
  }
  const output = globalThis.document.createElement("canvas");
  output.width = source.width * scale;
  output.height = source.height * scale;
  const outputContext = output.getContext("2d")!;
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(source, 0, 0, output.width, output.height);
  const suffix = scaleSuffix(scale);
  downloadBlob(await canvasBlob(output), `${safeName(pixelDocument.id)}-sheet${suffix}.png`);
  downloadBlob(
    new Blob([
      JSON.stringify({
        width: output.width,
        height: output.height,
        frames: pixelDocument.frames.map((frame, index) => ({
          id: frame.id,
          x: index * pixelDocument.canvas.width * scale,
          y: 0,
          width: pixelDocument.canvas.width * scale,
          height: pixelDocument.canvas.height * scale,
          durationMs: frame.durationMs
        }))
      }, null, 2)
    ], { type: "application/json" }),
    `${safeName(pixelDocument.id)}-sheet${suffix}.json`
  );
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png")
  );
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "pixel";
}

function scaleSuffix(scale: number): string {
  return scale > 1 ? `-${scale}x` : "";
}
