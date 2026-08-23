import { createPixelDocument } from "@editable-pixel/document";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { renderRgba } from "./index.js";
import { renderLayerPng, renderPng, renderPreviewPng, renderSpriteSheet } from "./node.js";

describe("Pixel Renderer", () => {
  it("renders palette indices to RGBA", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ff004dff"],
      pixels: [0, 1]
    });

    expect([...renderRgba(document).data]).toEqual([0, 0, 0, 0, 255, 0, 77, 255]);
  });

  it("creates deterministic logical PNG output", async () => {
    const document = createPixelDocument({ width: 2, height: 2, pixels: [0, 1, 1, 0] });

    const first = await renderPng(document);
    const second = await renderPng(document);
    const decoded = await sharp(first).raw().toBuffer({ resolveWithObject: true });

    expect(first.equals(second)).toBe(true);
    expect(decoded.info.width).toBe(2);
    expect(decoded.info.height).toBe(2);
  });

  it("enlarges previews with nearest-neighbor pixels", async () => {
    const document = createPixelDocument({ width: 2, height: 2, pixels: [0, 1, 1, 0] });
    const preview = await renderPreviewPng(document, 4);
    const metadata = await sharp(preview).metadata();

    expect(metadata.width).toBe(8);
    expect(metadata.height).toBe(8);
  });

  it("exports a horizontal sprite sheet with matching metadata", async () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 120 });
    document.layers[0]!.frames["frame-2"] = [1, 0, 0, 1];

    const sheet = await renderSpriteSheet(document);
    const metadata = await sharp(sheet.png).metadata();

    expect(metadata.width).toBe(4);
    expect(metadata.height).toBe(2);
    expect(sheet.metadata.frames[1]).toMatchObject({ id: "frame-2", x: 2, durationMs: 120 });
  });

  it("renders requested frames and isolated layers", async () => {
    const document = createPixelDocument({
      width: 1, height: 1, palette: ["#00000000", "#ff0000ff", "#0000ffff"], pixels: [1]
    });
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 100 });
    document.layers[0]!.frames["frame-2"] = [2];
    document.layers.push({
      id: "overlay",
      name: "Overlay",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      frames: { "frame-1": [2], "frame-2": [0] }
    });

    const frame = await sharp(await renderPng(document, { frameId: "frame-2" })).raw().toBuffer();
    const layer = await sharp(await renderLayerPng(document, "artwork", "frame-1")).raw().toBuffer();

    expect([...frame]).toEqual([0, 0, 255, 255]);
    expect([...layer]).toEqual([255, 0, 0, 255]);
  });
});
