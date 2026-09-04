/**
 * Minimal GIF89a header reader used to assert the animation output.
 *
 * `gifenc` writes the GIFs and no decoder ships with the runtime, so this
 * walks the block structure far enough to recover the logical screen size,
 * the frame count and the per-frame delays. It is deliberately not a decoder:
 * pixel data is skipped, never expanded.
 */
export interface GifMetadata {
  width: number;
  height: number;
  frames: number;
  delays: number[];
}

const EXTENSION = 0x21;
const IMAGE_DESCRIPTOR = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;

export function readGifMetadata(gif: Uint8Array): GifMetadata {
  const header = new TextDecoder().decode(gif.subarray(0, 6));
  if (header !== "GIF89a" && header !== "GIF87a") {
    throw new Error(`Not a GIF: ${header}`);
  }
  const view = new DataView(gif.buffer, gif.byteOffset, gif.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const packed = gif[10]!;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1));

  const delays: number[] = [];
  let frames = 0;
  let pendingDelay = 0;
  while (offset < gif.length) {
    const block = gif[offset]!;
    if (block === TRAILER) break;
    if (block === EXTENSION) {
      const label = gif[offset + 1]!;
      // Graphic control extensions carry the delay in hundredths of a second.
      if (label === GRAPHIC_CONTROL) pendingDelay = view.getUint16(offset + 4, true) * 10;
      offset = skipSubBlocks(gif, offset + 2);
      continue;
    }
    if (block === IMAGE_DESCRIPTOR) {
      frames += 1;
      delays.push(pendingDelay);
      pendingDelay = 0;
      const localPacked = gif[offset + 9]!;
      offset += 10;
      if ((localPacked & 0x80) !== 0) offset += 3 * (1 << ((localPacked & 0x07) + 1));
      offset += 1; // LZW minimum code size
      offset = skipSubBlocks(gif, offset);
      continue;
    }
    throw new Error(`Unexpected GIF block 0x${block.toString(16)} at ${offset}.`);
  }
  return { width, height, frames, delays };
}

function skipSubBlocks(gif: Uint8Array, start: number): number {
  let offset = start;
  while (offset < gif.length) {
    const size = gif[offset]!;
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  throw new Error("GIF sub-block chain is unterminated.");
}
