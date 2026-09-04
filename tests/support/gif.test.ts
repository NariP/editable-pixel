import { DEFAULT_FRAME_LIGHTING, createPixelDocument, type PixelDocument } from "@editable-pixel/document";
import { renderAnimationGif } from "@editable-pixel/renderer";
import { describe, expect, it } from "vitest";

import { decodeGif } from "./gif.js";

const PALETTE = ["#00000000", "#ff7a00ff", "#00dff7ff"];
const RGBA = [[0, 0, 0, 0], [255, 122, 0, 255], [0, 223, 247, 255]];

/** Builds a 4x2 animation whose frames overlap, so leaked pixels are visible. */
function animate(framePixels: number[][], durations: number[]): PixelDocument {
  const document = createPixelDocument({ width: 4, height: 2, palette: PALETTE });
  const layer = document.layers[0]!;
  document.frames = framePixels.map((_, index) => ({
    id: `frame-${index + 1}`,
    name: `Frame ${index + 1}`,
    durationMs: durations[index]!,
    lighting: { ...DEFAULT_FRAME_LIGHTING }
  }));
  layer.frames = Object.fromEntries(
    framePixels.map((pixels, index) => [`frame-${index + 1}`, [...pixels]])
  );
  return document;
}

const expand = (pixels: number[]) => Uint8ClampedArray.from(pixels.flatMap((index) => RGBA[index]!));

describe("decodeGif", () => {
  it("reads the logical screen size, frame count and per-frame delays", () => {
    const gif = renderAnimationGif(animate([[1, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 2, 0, 0, 0, 0]], [80, 230]));
    const decoded = decodeGif(gif);

    expect({ width: decoded.width, height: decoded.height, frames: decoded.frames.length })
      .toEqual({ width: 4, height: 2, frames: 2 });
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([80, 230]);
  });

  it("clears pixels between frames because gifenc emits disposal method 2", () => {
    // Frame 1 paints the top-left corner, frame 2 paints only the bottom-right.
    // Without disposal handling the corner from frame 1 would leak into frame 2.
    const first = [1, 1, 0, 0, 0, 0, 0, 0];
    const second = [0, 0, 0, 0, 0, 0, 2, 2];
    const decoded = decodeGif(renderAnimationGif(animate([first, second], [100, 100])));

    expect(Buffer.from(decoded.frames[0]!.data)).toEqual(Buffer.from(expand(first)));
    expect(Buffer.from(decoded.frames[1]!.data)).toEqual(Buffer.from(expand(second)));
  });

  it("emits disposal method 2 in the encoded stream when the palette has a transparent entry", () => {
    const gif = renderAnimationGif(animate([[1, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 2, 0, 0, 0, 0]], [100, 100]));

    expect(disposalMethods(gif)).toEqual([2, 2]);
  });

  it("keeps opaque pixels from earlier frames when disposal asks the canvas to persist", () => {
    // Disposal 1 ("do not dispose") accumulates, so the reader must not clear.
    const gif = withDisposal(
      renderAnimationGif(animate([[1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 2, 2]], [100, 100])),
      1
    );
    const decoded = decodeGif(gif);

    expect(Buffer.from(decoded.frames[1]!.data)).toEqual(Buffer.from(expand([1, 1, 0, 0, 0, 0, 2, 2])));
  });

  it("restores the pre-frame canvas when disposal method 3 is used", () => {
    // Only frame 2 disposes to "previous"; frames 1 and 3 keep the canvas, so
    // frame 3 must see frame 1's pixels again but not frame 2's.
    const gif = withDisposal(
      withDisposal(
        renderAnimationGif(animate([
          [1, 1, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 2, 2],
          [0, 0, 0, 0, 0, 0, 0, 0]
        ], [100, 100, 100])),
        1
      ),
      3,
      [1]
    );
    const decoded = decodeGif(gif);

    expect(Buffer.from(decoded.frames[1]!.data)).toEqual(Buffer.from(expand([1, 1, 0, 0, 0, 0, 2, 2])));
    expect(Buffer.from(decoded.frames[2]!.data)).toEqual(Buffer.from(expand([1, 1, 0, 0, 0, 0, 0, 0])));
  });
});

/** Rewrites the chosen graphic control extensions to use the given disposal method. */
function withDisposal(gif: Uint8Array, disposal: number, frames?: number[]): Uint8Array {
  const patched = Uint8Array.from(gif);
  graphicControlOffsets(patched).forEach((offset, frame) => {
    if (frames && !frames.includes(frame)) return;
    patched[offset + 3] = (patched[offset + 3]! & ~0x1c) | (disposal << 2);
  });
  return patched;
}

function disposalMethods(gif: Uint8Array): number[] {
  return graphicControlOffsets(gif).map((offset) => (gif[offset + 3]! >> 2) & 0x07);
}

/** Walks the block structure and reports where each graphic control extension starts. */
function graphicControlOffsets(gif: Uint8Array): number[] {
  const packed = gif[10]!;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1));

  const offsets: number[] = [];
  while (offset < gif.length && gif[offset] !== 0x3b) {
    if (gif[offset] === 0x21) {
      if (gif[offset + 1] === 0xf9) offsets.push(offset);
      offset = skipSubBlocks(gif, offset + 2);
      continue;
    }
    if (gif[offset] !== 0x2c) throw new Error(`Unexpected GIF block 0x${gif[offset]!.toString(16)}.`);
    const localPacked = gif[offset + 9]!;
    offset += 10;
    if ((localPacked & 0x80) !== 0) offset += 3 * (1 << ((localPacked & 0x07) + 1));
    offset = skipSubBlocks(gif, offset + 1);
  }
  return offsets;
}

function skipSubBlocks(gif: Uint8Array, start: number): number {
  let offset = start;
  while (offset < gif.length) {
    const size = gif[offset]!;
    offset += 1;
    if (size === 0) break;
    offset += size;
  }
  return offset;
}
