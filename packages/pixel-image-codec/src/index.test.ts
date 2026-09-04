import { describe, expect, it } from "vitest";

import {
  blitRgba,
  compositeRgba,
  decodeImage,
  decodeJpeg,
  decodePng,
  decodeWebp,
  detectImageFormat,
  encodePng,
  resizeNearest,
  type RgbaImage
} from "./index.js";

/**
 * Golden fixtures captured from `sharp@0.35.3` before it was removed, so this
 * suite is a genuine parity check rather than a self-consistency check.
 *
 * `SOURCE` is a 5x4 RGBA image with a rotating alpha of 255/128/0 and no
 * repeating colours, which makes an off-by-one sample grid or a swapped
 * channel order impossible to miss.
 */
const SOURCE: RgbaImage = {
  width: 5,
  height: 4,
  data: new Uint8ClampedArray([
    0, 13, 255, 255, 37, 104, 238, 128, 74, 195, 221, 0, 111, 30, 204, 255, 148, 121, 187, 128,
    185, 212, 170, 0, 222, 47, 153, 255, 3, 138, 136, 128, 40, 229, 119, 0, 77, 64, 102, 255,
    114, 155, 85, 128, 151, 246, 68, 0, 188, 81, 51, 255, 225, 172, 34, 128, 6, 7, 17, 0,
    43, 98, 0, 255, 80, 189, 0, 128, 117, 24, 0, 0, 154, 115, 0, 255, 191, 206, 0, 128
  ])
};

/** `SOURCE` with alpha forced opaque — the lossy formats carry no alpha. */
const OPAQUE_SOURCE: RgbaImage = {
  width: 5,
  height: 4,
  data: new Uint8ClampedArray([
    0, 13, 255, 255, 37, 104, 238, 255, 74, 195, 221, 255, 111, 30, 204, 255, 148, 121, 187, 255,
    185, 212, 170, 255, 222, 47, 153, 255, 3, 138, 136, 255, 40, 229, 119, 255, 77, 64, 102, 255,
    114, 155, 85, 255, 151, 246, 68, 255, 188, 81, 51, 255, 225, 172, 34, 255, 6, 7, 17, 255,
    43, 98, 0, 255, 80, 189, 0, 255, 117, 24, 0, 255, 154, 115, 0, 255, 191, 206, 0, 255
  ])
};

// sharp(SOURCE).png(), sharp(OPAQUE_SOURCE).webp({lossless:true}) and
// sharp(OPAQUE_SOURCE).jpeg({quality:100, chromaSubsampling:"4:4:4"}).
const SHARP_PNG = fixture(
  "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAX0lEQVQImQFUAKv/AAAN"
  + "//8laO6ASsPdAG8ezP+UebuAALnUqgDeL5n/A4qIgCjldwBNQGb/AHKbVYCX9kQAvFEz/+GsIoAGBxEAACtiAP9QvQCAdRgA"
  + "AJpzAP+/zgCAbbYkdvGDv0QAAAAASUVORK5CYII="
);
const SHARP_WEBP = fixture(
  "UklGRjYAAABXRUJQVlA4TCoAAAAvBMAAALmM6H/sIgre/wBBtg3BCAt8szO8AZAg26b+KocbwiNyM7PdkyQ="
);
const SHARP_JPEG = fixture(
  "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/"
  + "2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAAR"
  + "CAAEAAUDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABsQAAIDAQEBAAAAAAAAAAAAAAQGAwUHCAEX/8QAFQEB"
  + "AQAAAAAAAAAAAAAAAAAABQn/xAAeEQACAgMBAAMAAAAAAAAAAAAEBQMGAQIHFggJE//aAAwDAQACEQMRAD8AI4Hi4fYIrX5K"
  + "+P3No+Z/OY6sDl4hSRKy2B0bIUJ3OpLSsdFDRwK9ZWWotmuEdWTx1VcV53duiCq/RrEWACVPbPs/+XXP2qhmfdxumGWz1Wxk"
  + "3TtHT2UIit3awooTwyVL5AWS1aqIFIL5u7IcNG0SBLsQX+osshCtEqqKPnVPua4LKR7ePS72nCUkpciZlU20NqIjaQ1KGbyS"
  + "Z3JWK8nCsT1CjVObqYDE7up1he4yzz//2Q=="
);

function fixture(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function pixels(image: RgbaImage): number[] {
  return [...image.data];
}

describe("image codec", () => {
  describe("decoding", () => {
    it("sniffs the container format from the magic bytes", () => {
      expect(detectImageFormat(SHARP_PNG)).toBe("png");
      expect(detectImageFormat(SHARP_JPEG)).toBe("jpeg");
      expect(detectImageFormat(SHARP_WEBP)).toBe("webp");
      expect(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeUndefined();
      expect(detectImageFormat(new Uint8Array())).toBeUndefined();
    });

    it("decodes PNG, JPEG, and WebP to the same RGBA sharp produced", async () => {
      const png = await decodePng(SHARP_PNG);
      expect({ width: png.width, height: png.height }).toEqual({ width: 5, height: 4 });
      expect(pixels(png)).toEqual(pixels(SOURCE));

      // Lossless WebP must be exact too.
      const webp = await decodeWebp(SHARP_WEBP);
      expect(pixels(webp)).toEqual(pixels(OPAQUE_SOURCE));

      // JPEG is lossy: mozjpeg and libjpeg-turbo round the same DCT slightly
      // differently, so compare within a tolerance instead of byte for byte.
      const jpeg = await decodeJpeg(SHARP_JPEG);
      expect({ width: jpeg.width, height: jpeg.height }).toEqual({ width: 5, height: 4 });
      for (const [offset, expected] of pixels(OPAQUE_SOURCE).entries()) {
        expect(Math.abs(jpeg.data[offset]! - expected), `channel ${offset}`).toBeLessThanOrEqual(3);
      }
    });

    it("dispatches on the sniffed format and always reports 4-channel RGBA", async () => {
      for (const [source, format] of [
        [SHARP_PNG, "png"],
        [SHARP_JPEG, "jpeg"],
        [SHARP_WEBP, "webp"]
      ] as const) {
        const decoded = await decodeImage(source);
        expect(decoded.format).toBe(format);
        // `ensureAlpha()` is implicit: even JPEG, which carries no alpha
        // channel, comes back as 4 opaque channels.
        expect(decoded.data.length).toBe(decoded.width * decoded.height * 4);
        if (format !== "jpeg") continue;
        for (let offset = 3; offset < decoded.data.length; offset += 4) {
          expect(decoded.data[offset]).toBe(255);
        }
      }
    });

    it("rejects a container it cannot decode instead of guessing", async () => {
      await expect(decodeImage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/PNG, WebP, or JPEG/);
    });

    it("reports the sniffed bytes so an unsupported container is distinguishable from a truncated file", async () => {
      // Little-endian TIFF: a real format we do not support.
      await expect(decodeImage(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])))
        .rejects.toThrow("received 8 bytes starting 0x49492a00");
      // A truncated PNG: the same failure, but the message tells them apart.
      await expect(decodeImage(new Uint8Array([0x89, 0x50, 0x4e])))
        .rejects.toThrow("received 3 bytes starting 0x89504e");
      await expect(decodeImage(new Uint8Array())).rejects.toThrow("received 0 bytes");
    });
  });

  describe("nearest-neighbour resizing", () => {
    /**
     * Golden sample grids from `sharp.resize(w, h, { kernel: "nearest", fit:
     * "fill" })` on an opaque 5x4 source whose red channel is the pixel index.
     * The source is opaque because sharp premultiplies alpha while resizing,
     * which destroys the colour of fully transparent pixels; the pipeline
     * binarises alpha before resizing, so that path is never exercised.
     */
    const indexed: RgbaImage = {
      width: 5,
      height: 4,
      data: new Uint8ClampedArray(
        Array.from({ length: 20 }, (_unused, index) => [index, 0, 0, 255]).flat()
      )
    };
    const sharpGrids: Array<{ width: number; height: number; row: number[]; column: number[] }> = [
      { width: 10, height: 8, row: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], column: [0, 0, 5, 5, 10, 10, 15, 15] },
      {
        width: 15,
        height: 12,
        row: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
        column: [0, 0, 0, 5, 5, 5, 10, 10, 10, 15, 15, 15]
      },
      { width: 2, height: 2, row: [6, 8], column: [6, 16] },
      { width: 3, height: 2, row: [5, 7, 9], column: [5, 15] },
      {
        width: 20,
        height: 4,
        row: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4],
        column: [0, 5, 10, 15]
      }
    ];

    it.each(sharpGrids)("matches sharp's grid for $width x $height", ({ width, height, row, column }) => {
      const resized = resizeNearest(indexed, width, height);
      expect({ width: resized.width, height: resized.height }).toEqual({ width, height });
      expect(Array.from({ length: width }, (_unused, x) => resized.data[x * 4])).toEqual(row);
      expect(Array.from({ length: height }, (_unused, y) => resized.data[y * width * 4])).toEqual(column);
    });

    it("stretches to the target box, ignoring the source aspect ratio", () => {
      const resized = resizeNearest(indexed, 5, 12);
      expect({ width: resized.width, height: resized.height }).toEqual({ width: 5, height: 12 });
      // 4 source rows over 12 target rows: each row triples.
      const column = Array.from({ length: 12 }, (_unused, y) => resized.data[y * 5 * 4]);
      expect(column).toEqual([0, 0, 0, 5, 5, 5, 10, 10, 10, 15, 15, 15]);
    });

    it("duplicates pixels exactly on integer upscales and copies at 1:1", () => {
      const doubled = resizeNearest(SOURCE, 10, 8);
      expect(pixels(doubled).slice(0, 4)).toEqual(pixels(SOURCE).slice(0, 4));
      expect(pixels(doubled).slice(4, 8)).toEqual(pixels(SOURCE).slice(0, 4));
      expect(pixels(doubled).slice(8, 12)).toEqual(pixels(SOURCE).slice(4, 8));

      const identity = resizeNearest(SOURCE, 5, 4);
      expect(pixels(identity)).toEqual(pixels(SOURCE));
      expect(identity.data).not.toBe(SOURCE.data);
    });

    it("rejects degenerate target sizes", () => {
      expect(() => resizeNearest(SOURCE, 0, 4)).toThrow(RangeError);
      expect(() => resizeNearest(SOURCE, 3, 1.5)).toThrow(RangeError);
    });
  });

  describe("compositing", () => {
    it("tiles sprite-sheet frames the way sharp's composite did", () => {
      const tiles = [0, 1, 2].map((index) => ({
        width: 2,
        height: 2,
        data: new Uint8ClampedArray(
          Array.from({ length: 4 }, (_unused, pixel) => [index * 80 + pixel, index * 10, 200 - pixel * 5, 255]).flat()
        )
      }));
      const sheet = compositeRgba(6, 2, tiles.map((image, index) => ({ image, left: index * 2, top: 0 })));

      expect({ width: sheet.width, height: sheet.height }).toEqual({ width: 6, height: 2 });
      // Row 0 is the top row of every tile, row 1 the bottom row.
      expect(pixels(sheet).slice(0, 24)).toEqual([
        0, 0, 200, 255, 1, 0, 195, 255,
        80, 10, 200, 255, 81, 10, 195, 255,
        160, 20, 200, 255, 161, 20, 195, 255
      ]);
      expect(pixels(sheet).slice(24)).toEqual([
        2, 0, 190, 255, 3, 0, 185, 255,
        82, 10, 190, 255, 83, 10, 185, 255,
        162, 20, 190, 255, 163, 20, 185, 255
      ]);
    });

    it("starts from a fully transparent canvas and leaves gaps untouched", () => {
      const dot: RgbaImage = { width: 1, height: 1, data: new Uint8ClampedArray([9, 8, 7, 255]) };
      const sheet = compositeRgba(3, 1, [{ image: dot, left: 1, top: 0 }]);

      expect(pixels(sheet)).toEqual([0, 0, 0, 0, 9, 8, 7, 255, 0, 0, 0, 0]);
    });

    it("clips rows that fall outside the target instead of wrapping them", () => {
      const target = new Uint8ClampedArray(2 * 2 * 4);
      const input = new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
      blitRgba(target, 2, input, { x: 0, y: 1, width: 2, height: 2 });

      expect([...target]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 255, 2, 2, 2, 255]);
    });

    it("clips columns rather than wrapping them into the next row", () => {
      const target = new Uint8ClampedArray(2 * 2 * 4);
      const input = new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
      blitRgba(target, 2, input, { x: 1, y: 0, width: 2, height: 2 });

      // Column 1 of each row is filled; the overhanging column is dropped.
      expect([...target]).toEqual([0, 0, 0, 0, 1, 1, 1, 255, 0, 0, 0, 0, 3, 3, 3, 255]);
    });

    it("rejects a source buffer shorter than its declared rectangle", () => {
      // sharp's .composite() threw on a raw buffer that disagreed with its
      // declared size; a bare subarray would instead paint half the tile.
      const target = new Uint8ClampedArray(4 * 4 * 4);
      const short = new Uint8ClampedArray(2 * 2 * 4 - 4);

      expect(() => blitRgba(target, 4, short, { x: 0, y: 0, width: 2, height: 2 }))
        .toThrow(RangeError);
      expect(() => blitRgba(target, 4, short, { x: 0, y: 0, width: 2, height: 2 }))
        .toThrow(/holds 12 bytes but 2x2 RGBA needs 16/);
      // The target is untouched: validation happens before any write.
      expect(target.some((byte) => byte !== 0)).toBe(false);

      // An oversized source is fine — extra capacity is simply not read.
      expect(() => blitRgba(target, 4, new Uint8ClampedArray(64), { x: 0, y: 0, width: 2, height: 2 }))
        .not.toThrow();
    });

    it("rejects a target buffer that is not a whole number of rows", () => {
      // Otherwise `targetHeight` is fractional and the vertical bound check
      // stops being meaningful.
      // 40 bytes is 2.5 rows of 4px RGBA.
      const ragged = new Uint8ClampedArray(40);
      const input = new Uint8ClampedArray(4 * 4);

      expect(() => blitRgba(ragged, 4, input, { x: 0, y: 0, width: 2, height: 2 }))
        .toThrow(/not a whole number of 4px RGBA rows/);
      expect(() => blitRgba(new Uint8ClampedArray(16), 0, input, { x: 0, y: 0, width: 2, height: 2 }))
        .toThrow(RangeError);
    });

    it("rejects degenerate rectangles and fractional offsets", () => {
      const target = new Uint8ClampedArray(4 * 4 * 4);
      const input = new Uint8ClampedArray(4 * 4);

      expect(() => blitRgba(target, 4, input, { x: 0, y: 0, width: 0, height: 2 })).toThrow(RangeError);
      expect(() => blitRgba(target, 4, input, { x: 0, y: 0, width: 2, height: 1.5 })).toThrow(RangeError);
      expect(() => blitRgba(target, 4, input, { x: 0.5, y: 0, width: 2, height: 2 })).toThrow(RangeError);
    });

    it("propagates the size check through compositeRgba", () => {
      const truncated: RgbaImage = { width: 2, height: 2, data: new Uint8ClampedArray(8) };

      expect(() => compositeRgba(4, 4, [{ image: truncated, left: 0, top: 0 }])).toThrow(RangeError);
    });
  });

  describe("PNG encoding", () => {
    it("writes a valid PNG that decodes back to the original pixels", async () => {
      const encoded = await encodePng(SOURCE);

      expect([...encoded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // IHDR immediately follows the signature and carries the dimensions.
      expect(new TextDecoder().decode(encoded.subarray(12, 16))).toBe("IHDR");
      const header = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      expect(header.getUint32(16)).toBe(SOURCE.width);
      expect(header.getUint32(20)).toBe(SOURCE.height);

      const decoded = await decodePng(encoded);
      expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 5, height: 4 });
      expect(pixels(decoded)).toEqual(pixels(SOURCE));
    });

    it("is deterministic and reads a subarray view without leaking neighbours", async () => {
      const pool = new Uint8ClampedArray(SOURCE.data.length + 8).fill(200);
      pool.set(SOURCE.data, 4);
      const view = { width: 5, height: 4, data: pool.subarray(4, 4 + SOURCE.data.length) };

      const first = await encodePng(SOURCE);
      const second = await encodePng(view);

      expect([...second]).toEqual([...first]);
      expect(pixels(await decodePng(second))).toEqual(pixels(SOURCE));
    });

    it("rejects degenerate dimensions", async () => {
      await expect(encodePng({ width: 0, height: 1, data: new Uint8ClampedArray() }))
        .rejects.toThrow(RangeError);
    });
  });
});
