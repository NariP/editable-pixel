import { resolveFrameLighting, serializePixelDocument, type PixelDocument } from "@editable-pixel/document";
import { serializePixelProject, type PixelProject } from "@editable-pixel/project";
import {
  renderLitRgba,
  renderNormalRgba,
  renderRgba,
  renderAnimationGif,
  type LightSettings,
  type RenderedRgba
} from "@editable-pixel/renderer";

export function downloadDocument(pixelDocument: PixelDocument, compact = false): void {
  downloadBlob(
    new Blob([serializePixelDocument(pixelDocument, !compact)], { type: "application/json" }),
    `${safeName(pixelDocument.id)}${compact ? ".compact" : ""}.pixel.json`
  );
}

export function downloadProject(project: PixelProject, compact = false): void {
  downloadBlob(
    new Blob([serializePixelProject(project, !compact)], { type: "application/json" }),
    `${safeName(project.name)}${compact ? ".compact" : ""}.pixel-project.json`
  );
}

export async function downloadPng(
  pixelDocument: PixelDocument,
  options: { frameId?: string; layerIds?: string[]; scale?: number; name?: string } = {}
): Promise<void> {
  const rendered = renderRgba(pixelDocument, options);
  await downloadRenderedPng(
    rendered,
    options.scale ?? 1,
    options.name ?? `${safeName(pixelDocument.id)}${scaleSuffix(options.scale ?? 1)}.png`
  );
}

export async function downloadNormalPng(
  pixelDocument: PixelDocument,
  options: { frameId?: string; layerIds?: string[]; scale?: number; name?: string } = {}
): Promise<void> {
  const rendered = renderNormalRgba(pixelDocument, options);
  await downloadRenderedPng(
    rendered,
    options.scale ?? 1,
    options.name ?? `${safeName(pixelDocument.id)}-normal${scaleSuffix(options.scale ?? 1)}.png`
  );
}

export async function downloadLitPng(
  pixelDocument: PixelDocument,
  light: LightSettings,
  options: { frameId?: string; layerIds?: string[]; scale?: number; name?: string } = {}
): Promise<void> {
  const rendered = renderLitRgba(pixelDocument, light, options);
  await downloadRenderedPng(
    rendered,
    options.scale ?? 1,
    options.name ?? `${safeName(pixelDocument.id)}-lit${scaleSuffix(options.scale ?? 1)}.png`
  );
}

async function downloadRenderedPng(rendered: RenderedRgba, scale: number, name: string): Promise<void> {
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
  downloadBlob(blob, name);
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

export async function downloadFramePngs(pixelDocument: PixelDocument, scale = 1, frameIds = pixelDocument.frames.map((frame) => frame.id)): Promise<void> {
  for (const frameId of frameIds) {
    const frame = pixelDocument.frames.find((candidate) => candidate.id === frameId);
    if (!frame) continue;
    await downloadPng(pixelDocument, {
      frameId: frame.id,
      scale,
      name: `${safeName(pixelDocument.id)}-${safeName(frame.name)}${scaleSuffix(scale)}.png`
    });
  }
}

export async function downloadNormalFramePngs(pixelDocument: PixelDocument, scale = 1, frameIds = pixelDocument.frames.map((frame) => frame.id)): Promise<void> {
  for (const frameId of frameIds) {
    const frame = pixelDocument.frames.find((candidate) => candidate.id === frameId);
    if (!frame) continue;
    await downloadNormalPng(pixelDocument, {
      frameId: frame.id,
      scale,
      name: `${safeName(pixelDocument.id)}-${safeName(frame.name)}-normal${scaleSuffix(scale)}.png`
    });
  }
}

export async function downloadLitFramePngs(pixelDocument: PixelDocument, scale = 1, frameIds = pixelDocument.frames.map((frame) => frame.id)): Promise<void> {
  for (const frameId of frameIds) {
    const frame = pixelDocument.frames.find((candidate) => candidate.id === frameId);
    if (!frame) continue;
    await downloadLitPng(pixelDocument, resolveFrameLighting(pixelDocument, frameIds, frame.id), {
      frameId,
      scale,
      name: `${safeName(pixelDocument.id)}-${safeName(frame.name)}-lit${scaleSuffix(scale)}.png`
    });
  }
}

export async function downloadSpriteSheet(pixelDocument: PixelDocument, scale = 1, frameIds = pixelDocument.frames.map((frame) => frame.id), name?: string): Promise<void> {
  await downloadSheet(pixelDocument, scale, "color", frameIds, name);
}

export async function downloadNormalSpriteSheet(pixelDocument: PixelDocument, scale = 1, frameIds = pixelDocument.frames.map((frame) => frame.id), name?: string): Promise<void> {
  await downloadSheet(pixelDocument, scale, "normal", frameIds, name);
}

export async function downloadLitSpriteSheet(
  pixelDocument: PixelDocument,
  scale = 1,
  frameIds = pixelDocument.frames.map((frame) => frame.id),
  name?: string,
  lightingSequences: readonly (readonly string[])[] = [frameIds]
): Promise<void> {
  await downloadSheet(pixelDocument, scale, "lit", frameIds, name, lightingSequences);
}

export function downloadAnimationGif(
  pixelDocument: PixelDocument,
  scale = 1,
  frameIds = pixelDocument.frames.map((frame) => frame.id),
  name?: string
): void {
  const bytes = renderAnimationGif(pixelDocument, { scale, frameIds });
  downloadBlob(
    new Blob([Uint8Array.from(bytes)], { type: "image/gif" }),
    `${safeName(name ?? pixelDocument.id)}${scaleSuffix(scale)}.gif`
  );
}

async function downloadSheet(
  pixelDocument: PixelDocument,
  scale: number,
  map: "color" | "normal" | "lit",
  frameIds: string[],
  name?: string,
  lightingSequences: readonly (readonly string[])[] = [frameIds]
): Promise<void> {
  const frames = frameIds.flatMap((frameId) => {
    const frame = pixelDocument.frames.find((candidate) => candidate.id === frameId);
    return frame ? [frame] : [];
  });
  if (frames.length === 0) throw new Error("The export scope has no frames.");
  const source = globalThis.document.createElement("canvas");
  source.width = pixelDocument.canvas.width * frames.length;
  source.height = pixelDocument.canvas.height;
  const sourceContext = source.getContext("2d")!;
  for (const [index, frame] of frames.entries()) {
    const rendered = map === "normal"
      ? renderNormalRgba(pixelDocument, { frameId: frame.id })
      : map === "lit"
        ? renderLitRgba(
          pixelDocument,
          resolveFrameLighting(
            pixelDocument,
            lightingSequences.find((sequence) => sequence.includes(frame.id)) ?? frameIds,
            frame.id
          ),
          { frameId: frame.id }
        )
      : renderRgba(pixelDocument, { frameId: frame.id });
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
  const mapSuffix = map === "normal" ? "-normal" : map === "lit" ? "-lit" : "";
  const baseName = safeName(name ?? pixelDocument.id);
  downloadBlob(await canvasBlob(output), `${baseName}${mapSuffix}-sheet${suffix}.png`);
  downloadBlob(
    new Blob([
      JSON.stringify({
        width: output.width,
        height: output.height,
        frames: frames.map((frame, index) => ({
          id: frame.id,
          x: index * pixelDocument.canvas.width * scale,
          y: 0,
          width: pixelDocument.canvas.width * scale,
          height: pixelDocument.canvas.height * scale,
          durationMs: frame.durationMs
        }))
      }, null, 2)
    ], { type: "application/json" }),
    `${baseName}${mapSuffix}-sheet${suffix}.json`
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
