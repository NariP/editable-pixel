import { createPixelDocument } from "@editable-pixel/document";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { renderAnimationGif, renderLitRgba, renderNormalRgba, renderRgba } from "./index.js";
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

  it("renders normal maps with artwork transparency", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ffffffff"],
      pixels: [1, 0]
    });
    document.layers[0]!.normalFrames = { "frame-1": [0xff80b5, 0x80ffb5] };

    expect([...renderNormalRgba(document).data]).toEqual([255, 128, 181, 255, 0, 0, 0, 0]);
  });

  it("changes lit output when a normal faces or turns away from the light", () => {
    const document = createPixelDocument({
      width: 1,
      height: 1,
      palette: ["#00000000", "#ffffffff"],
      pixels: [1]
    });
    document.layers[0]!.normalFrames = { "frame-1": [0xff8080] };
    const right = renderLitRgba(document, { x: 1, y: 0.5, height: 0.5, intensity: 1, ambient: 0.1, shading: "smooth" });
    const left = renderLitRgba(document, { x: 0, y: 0.5, height: 0.5, intensity: 1, ambient: 0.1, shading: "smooth" });

    expect(right.data[0]).toBeGreaterThan(left.data[0]!);
    expect(right.data[3]).toBe(255);
  });

  it("renders a discrete generated palette ramp around the untouched base color", () => {
    const document = createPixelDocument({
      width: 1,
      height: 1,
      palette: ["#00000000", "#f06010ff"],
      pixels: [1]
    });
    const lighting = { x: 0.5, y: 0.5, height: 1, shading: "toon-palette" as const, toonSteps: 4 };
    const shadow = renderLitRgba(document, { ...lighting, intensity: 0, ambient: 0 });
    const base = renderLitRgba(document, { ...lighting, intensity: 0, ambient: 1 });
    const highlight = renderLitRgba(document, { ...lighting, intensity: 1, ambient: 1 });

    expect([...base.data]).toEqual([240, 96, 16, 255]);
    expect(shadow.data[0]).toBeLessThan(base.data[0]!);
    expect(shadow.data[1]).toBeLessThan(base.data[1]!);
    expect(highlight.data[0]).toBeGreaterThanOrEqual(base.data[0]!);
    expect(highlight.data[1]).toBeGreaterThan(base.data[1]!);
    expect(highlight.data[3]).toBe(255);
  });

  it.each([3, 5])("reaches a visible highlight with ordinary Toon light controls at %i steps", (toonSteps) => {
    const document = createPixelDocument({
      width: 1,
      height: 1,
      palette: ["#00000000", "#f06010ff"],
      pixels: [1]
    });
    const lit = renderLitRgba(document, {
      x: 0.5,
      y: 0.5,
      height: 0.7,
      intensity: 0.5,
      ambient: 0.55,
      shading: "toon-palette",
      toonSteps
    });

    expect(lit.data[0]).toBeGreaterThanOrEqual(240);
    expect(lit.data[1]).toBeGreaterThan(96);
    expect(lit.data[2]).toBeGreaterThan(16);
    expect(lit.data[3]).toBe(255);
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

  it("exports a nearest-neighbor GIF with ordered frames and per-frame timing", async () => {
    const document = createPixelDocument({ width: 2, height: 1, pixels: [1, 0] });
    document.frames[0]!.durationMs = 80;
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 140 });
    document.layers[0]!.frames["frame-2"] = [0, 1];

    const gif = renderAnimationGif(document, { scale: 3 });
    const metadata = await sharp(gif, { animated: true }).metadata();

    expect([...gif.slice(0, 6)]).toEqual([...new TextEncoder().encode("GIF89a")]);
    expect(metadata.width).toBe(6);
    expect(metadata.pageHeight).toBe(3);
    expect(metadata.pages).toBe(2);
    expect(metadata.delay).toEqual([80, 140]);
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
