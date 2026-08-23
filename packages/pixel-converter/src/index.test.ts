import { renderPng } from "@editable-pixel/renderer/node";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { convertBatch, convertImage } from "./index.js";

async function rgbaPng(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>
): Promise<Buffer> {
  return sharp(Buffer.from(pixels.flat()), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rgbaImage(
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>,
  format: "png" | "webp" | "jpeg"
): Promise<Buffer> {
  const image = sharp(Buffer.from(pixels.flat()), { raw: { width, height, channels: 4 } });
  if (format === "webp") return image.webp({ lossless: true }).toBuffer();
  if (format === "jpeg") return image.flatten({ background: "#ffffff" }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  return image.png().toBuffer();
}

describe("Pixel Converter", () => {
  it("converts transparent input deterministically", async () => {
    const input = await rgbaPng(2, 2, [
      [0, 0, 0, 0], [255, 0, 0, 255],
      [255, 0, 0, 255], [0, 0, 0, 0]
    ]);
    const options = { canvasWidth: 4, canvasHeight: 4, colorCount: 4, contentScale: 1 } as const;
    const first = await convertImage(input, options, { name: "red.png", mimeType: "image/png" });
    const second = await convertImage(input, options, { name: "red.png", mimeType: "image/png" });

    expect(first.document).toEqual(second.document);
    expect(first.document.palette).toEqual(["#00000000", "#ff0000ff"]);
    expect(first.document.metadata.source?.digest).toHaveLength(64);
  });

  it("removes a solid background", async () => {
    const input = await rgbaPng(3, 1, [
      [255, 255, 255, 255], [255, 0, 0, 255], [255, 255, 255, 255]
    ]);
    const result = await convertImage(input, {
      canvasWidth: 3,
      canvasHeight: 1,
      contentScale: 1,
      background: "solid",
      solidBackground: "#ffffffff",
      backgroundTolerance: 0
    });

    expect(result.document.layers[0]!.frames["frame-1"]).toEqual([0, 1, 0]);
  });

  it("requires an explicit local background-removal adapter", async () => {
    const input = await rgbaPng(1, 1, [[255, 0, 0, 255]]);

    await expect(convertImage(input, {
      canvasWidth: 1,
      canvasHeight: 1,
      background: "local-removal"
    })).rejects.toThrow("no background remover");
  });

  it("uses an explicitly supplied local background-removal adapter", async () => {
    const input = await rgbaPng(2, 1, [[255, 255, 255, 255], [255, 0, 0, 255]]);
    const removed = await rgbaPng(2, 1, [[0, 0, 0, 0], [255, 0, 0, 255]]);
    let calls = 0;
    const result = await convertImage(input, {
      canvasWidth: 2,
      canvasHeight: 1,
      contentScale: 1,
      background: "local-removal",
      backgroundRemover: async () => {
        calls += 1;
        return removed;
      }
    });

    expect(calls).toBe(1);
    expect(result.document.layers[0]!.frames["frame-1"]).toEqual([1, 0]);
  });

  it("uses a shared palette, content box, and pivot for batches", async () => {
    const red = await rgbaPng(1, 1, [[255, 0, 0, 255]]);
    const blue = await rgbaPng(1, 1, [[0, 0, 255, 255]]);
    const results = await convertBatch(
      [{ input: red }, { input: blue }],
      { canvasWidth: 4, canvasHeight: 4, colorCount: 3, alignment: "bottom-center" }
    );

    expect(results[0]!.document.palette).toEqual(results[1]!.document.palette);
    expect(results[0]!.document.contentBox).toEqual(results[1]!.document.contentBox);
    expect(results[0]!.document.pivot).toEqual(results[1]!.document.pivot);
  });

  it("keeps frame positions stable by normalizing a batch with one shared transform", async () => {
    const left = await rgbaPng(4, 1, [
      [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
    ]);
    const right = await rgbaPng(4, 1, [
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255]
    ]);
    const results = await convertBatch(
      [{ input: left }, { input: right }],
      {
        canvasWidth: 4,
        canvasHeight: 1,
        contentScale: 1,
        palette: ["#00000000", "#ff0000ff"]
      }
    );

    expect(results[0]!.document.layers[0]!.frames["frame-1"]).toEqual([1, 0, 0, 0]);
    expect(results[1]!.document.layers[0]!.frames["frame-1"]).toEqual([0, 0, 0, 1]);
  });

  it("preserves vertical frame offsets for jump animations", async () => {
    const grounded = await rgbaPng(1, 4, [
      [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255]
    ]);
    const airborne = await rgbaPng(1, 4, [
      [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]
    ]);
    const results = await convertBatch(
      [{ input: grounded }, { input: airborne }],
      {
        canvasWidth: 1,
        canvasHeight: 4,
        contentScale: 1,
        palette: ["#00000000", "#ff0000ff"]
      }
    );

    expect(results[0]!.document.layers[0]!.frames["frame-1"]).toEqual([0, 0, 0, 1]);
    expect(results[1]!.document.layers[0]!.frames["frame-1"]).toEqual([1, 0, 0, 0]);
  });

  it("round-trips a logical PNG with a fixed palette", async () => {
    const first = await convertImage(
      await rgbaPng(2, 2, [
        [0, 0, 0, 0], [255, 0, 77, 255],
        [255, 0, 77, 255], [0, 0, 0, 0]
      ]),
      {
        canvasWidth: 2,
        canvasHeight: 2,
        contentScale: 1,
        palette: ["#00000000", "#ff004dff"]
      }
    );
    const png = await renderPng(first.document);
    const second = await convertImage(png, {
      canvasWidth: 2,
      canvasHeight: 2,
      contentScale: 1,
      palette: first.document.palette
    });

    expect(second.document.layers[0]!.frames["frame-1"]).toEqual(
      first.document.layers[0]!.frames["frame-1"]
    );
  });

  it("rejects a full opaque fixed palette that has no slot for transparency", async () => {
    const input = await rgbaPng(1, 1, [[255, 0, 0, 255]]);
    const palette = Array.from({ length: 256 }, (_, index) => `#${index.toString(16).padStart(6, "0")}ff`);

    await expect(convertImage(input, {
      canvasWidth: 1,
      canvasHeight: 1,
      palette
    })).rejects.toThrow("must include a transparent color");
  });

  it.each(["webp", "jpeg"] as const)("decodes %s input", async (format) => {
    const input = await rgbaImage(3, 2, [
      [255, 255, 255, 255], [255, 0, 0, 255], [255, 255, 255, 255],
      [255, 255, 255, 255], [0, 0, 255, 255], [255, 255, 255, 255]
    ], format);
    const result = await convertImage(input, {
      canvasWidth: 6,
      canvasHeight: 4,
      background: "solid",
      solidBackground: "#ffffffff",
      backgroundTolerance: format === "jpeg" ? 18 : 0,
      colorCount: 4
    }, { name: `asset.${format}`, mimeType: `image/${format}` });

    expect(result.original).toMatchObject({ width: 3, height: 2, format });
    expect(result.document.metadata.source?.mimeType).toBe(`image/${format}`);
    expect(result.document.contentBounds.width).toBeGreaterThan(0);
  });

  it("places non-square content using center and bottom-center alignment", async () => {
    const input = await rgbaPng(1, 3, [
      [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]
    ]);
    const centered = await convertImage(input, {
      canvasWidth: 8, canvasHeight: 8, contentScale: 0.5, alignment: "center"
    });
    const bottom = await convertImage(input, {
      canvasWidth: 8, canvasHeight: 8, contentScale: 0.5, alignment: "bottom-center"
    });

    expect(centered.document.contentBounds.y).toBeLessThan(bottom.document.contentBounds.y);
    expect(centered.document.pivot.y).toBe(4);
    expect(bottom.document.pivot.y).toBe(7);
  });

  it("supports fixed palettes with deterministic dithering on and off", async () => {
    const input = await rgbaPng(8, 1, Array.from({ length: 8 }, (_, index) => {
      const value = 24 + index * 30;
      return [value, value, value, 255] as [number, number, number, number];
    }));
    const base = {
      canvasWidth: 8,
      canvasHeight: 1,
      contentScale: 1,
      palette: ["#00000000", "#000000ff", "#ffffffff"]
    };
    const plain = await convertImage(input, { ...base, dithering: "none" });
    const dithered = await convertImage(input, { ...base, dithering: "floyd-steinberg" });
    const repeated = await convertImage(input, { ...base, dithering: "floyd-steinberg" });

    expect(dithered.document).toEqual(repeated.document);
    expect(dithered.document.layers[0]!.frames["frame-1"]).not.toEqual(
      plain.document.layers[0]!.frames["frame-1"]
    );
  });

  it("normalizes a large source into a custom content box", async () => {
    const width = 1024;
    const height = 512;
    const raw = Buffer.alloc(width * height * 4);
    for (let offset = 0; offset < raw.length; offset += 4) {
      raw[offset] = 255;
      raw[offset + 3] = 255;
    }
    const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const result = await convertImage(input, {
      canvasWidth: 32,
      canvasHeight: 32,
      contentBox: { x: 4, y: 8, width: 24, height: 16 },
      colorCount: 2
    });

    expect(result.original).toMatchObject({ width, height });
    expect(result.document.contentBox).toEqual({ x: 4, y: 8, width: 24, height: 16 });
    expect(result.document.contentBounds).toEqual({ x: 4, y: 10, width: 24, height: 12 });
  });
});
