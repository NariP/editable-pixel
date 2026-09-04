/**
 * A GIF87a/89a reader for the export assertions.
 *
 * `gifenc` writes the animations and nothing in the runtime decodes GIF, so the
 * end-to-end test needs its own reader to check per-frame pixels and timing.
 * It handles exactly what `gifenc` emits: global or local palettes, LZW image
 * data, graphic control extensions, and the disposal methods that decide what
 * each frame is composited onto.
 */
export interface GifFrame {
  /** RGBA pixels of the composited frame, `width * height * 4` bytes. */
  data: Uint8ClampedArray;
  /** Frame delay in milliseconds. */
  delayMs: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: GifFrame[];
}

const EXTENSION = 0x21;
const IMAGE_DESCRIPTOR = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;

// Graphic control extension disposal methods (packed byte, bits 2-4).
const DISPOSAL_UNSPECIFIED = 0;
const DISPOSAL_RESTORE_BACKGROUND = 2;
const DISPOSAL_RESTORE_PREVIOUS = 3;

export function decodeGif(gif: Uint8Array): DecodedGif {
  const header = new TextDecoder().decode(gif.subarray(0, 6));
  if (header !== "GIF89a" && header !== "GIF87a") throw new Error(`Not a GIF: ${header}`);
  const view = new DataView(gif.buffer, gif.byteOffset, gif.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);

  const packed = gif[10]!;
  let offset = 13;
  let globalPalette: Uint8Array | undefined;
  if ((packed & 0x80) !== 0) {
    const size = 3 * (1 << ((packed & 0x07) + 1));
    globalPalette = gif.subarray(offset, offset + size);
    offset += size;
  }

  const frames: GifFrame[] = [];
  // The canvas persists between frames; GIF frames are patches, not full images.
  const canvas = new Uint8ClampedArray(width * height * 4);
  let delayMs = 0;
  let transparentIndex = -1;
  let disposal = DISPOSAL_UNSPECIFIED;

  while (offset < gif.length) {
    const block = gif[offset]!;
    if (block === TRAILER) break;

    if (block === EXTENSION) {
      if (gif[offset + 1] === GRAPHIC_CONTROL) {
        const flags = gif[offset + 3]!;
        delayMs = view.getUint16(offset + 4, true) * 10;
        transparentIndex = (flags & 0x01) !== 0 ? gif[offset + 6]! : -1;
        disposal = (flags >> 2) & 0x07;
      }
      offset = skipSubBlocks(gif, offset + 2);
      continue;
    }

    if (block !== IMAGE_DESCRIPTOR) {
      throw new Error(`Unexpected GIF block 0x${block.toString(16)} at ${offset}.`);
    }

    const left = view.getUint16(offset + 1, true);
    const top = view.getUint16(offset + 3, true);
    const frameWidth = view.getUint16(offset + 5, true);
    const frameHeight = view.getUint16(offset + 7, true);
    const localPacked = gif[offset + 9]!;
    if ((localPacked & 0x40) !== 0) throw new Error("Interlaced GIF frames are not supported.");
    offset += 10;

    let palette = globalPalette;
    if ((localPacked & 0x80) !== 0) {
      const size = 3 * (1 << ((localPacked & 0x07) + 1));
      palette = gif.subarray(offset, offset + size);
      offset += size;
    }
    if (!palette) throw new Error("GIF frame has neither a local nor a global palette.");

    const minimumCodeSize = gif[offset]!;
    offset += 1;
    const { data: compressed, next } = readSubBlocks(gif, offset);
    offset = next;
    const indices = inflateLzw(compressed, minimumCodeSize, frameWidth * frameHeight);

    // Disposal 3 restores the canvas as it was *before* this frame was drawn.
    const beforeFrame = disposal === DISPOSAL_RESTORE_PREVIOUS
      ? new Uint8ClampedArray(canvas)
      : undefined;

    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const index = indices[y * frameWidth + x]!;
        if (index === transparentIndex) continue;
        const target = ((top + y) * width + left + x) * 4;
        canvas[target] = palette[index * 3]!;
        canvas[target + 1] = palette[index * 3 + 1]!;
        canvas[target + 2] = palette[index * 3 + 2]!;
        canvas[target + 3] = 255;
      }
    }
    frames.push({ data: new Uint8ClampedArray(canvas), delayMs });

    // Disposal happens *after* the frame is shown and decides what the next
    // frame is drawn on top of. `gifenc` emits method 2 whenever the palette
    // has a transparent entry, so skipping this leaks pixels between frames.
    if (disposal === DISPOSAL_RESTORE_BACKGROUND) {
      for (let y = 0; y < frameHeight; y += 1) {
        const rowStart = ((top + y) * width + left) * 4;
        canvas.fill(0, rowStart, rowStart + frameWidth * 4);
      }
    } else if (disposal === DISPOSAL_RESTORE_PREVIOUS && beforeFrame) {
      canvas.set(beforeFrame);
    }

    delayMs = 0;
    transparentIndex = -1;
    disposal = DISPOSAL_UNSPECIFIED;
  }

  return { width, height, frames };
}

function readSubBlocks(gif: Uint8Array, start: number): { data: Uint8Array; next: number } {
  const chunks: Uint8Array[] = [];
  let offset = start;
  let total = 0;
  while (offset < gif.length) {
    const size = gif[offset]!;
    offset += 1;
    if (size === 0) break;
    chunks.push(gif.subarray(offset, offset + size));
    total += size;
    offset += size;
  }
  const data = new Uint8Array(total);
  let written = 0;
  for (const chunk of chunks) {
    data.set(chunk, written);
    written += chunk.length;
  }
  return { data, next: offset };
}

function skipSubBlocks(gif: Uint8Array, start: number): number {
  return readSubBlocks(gif, start).next;
}

/** Variable-width LZW as specified by GIF89a, least-significant bit first. */
function inflateLzw(compressed: Uint8Array, minimumCodeSize: number, pixelCount: number): Uint8Array {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const output = new Uint8Array(pixelCount);
  let written = 0;

  // Each dictionary entry is a prefix code plus one byte, so a sequence is
  // walked backwards from its tail. `length` lets us place it without a stack.
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Int32Array(4096);
  let nextCode = endCode + 1;
  let codeSize = minimumCodeSize + 1;
  let previous = -1;

  function reset(): void {
    for (let code = 0; code < clearCode; code += 1) {
      prefix[code] = -1;
      suffix[code] = code;
      length[code] = 1;
    }
    nextCode = endCode + 1;
    codeSize = minimumCodeSize + 1;
    previous = -1;
  }

  function firstByte(code: number): number {
    let current = code;
    while (prefix[current]! >= 0) current = prefix[current]!;
    return suffix[current]!;
  }

  function emit(code: number): void {
    let cursor = written + length[code]! - 1;
    for (let current = code; current >= 0; current = prefix[current]!) {
      output[cursor] = suffix[current]!;
      cursor -= 1;
    }
    written += length[code]!;
  }

  function define(prefixCode: number, first: number): void {
    if (nextCode >= 4096) return;
    prefix[nextCode] = prefixCode;
    suffix[nextCode] = first;
    length[nextCode] = length[prefixCode]! + 1;
    nextCode += 1;
    if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
  }

  reset();
  let bitBuffer = 0;
  let bitCount = 0;
  for (let index = 0; index < compressed.length; index += 1) {
    bitBuffer |= compressed[index]! << bitCount;
    bitCount += 8;
    while (bitCount >= codeSize) {
      const code = bitBuffer & ((1 << codeSize) - 1);
      bitBuffer >>>= codeSize;
      bitCount -= codeSize;

      if (code === clearCode) {
        reset();
        continue;
      }
      if (code === endCode) return output;
      if (previous < 0) {
        emit(code);
        previous = code;
        continue;
      }
      if (code < nextCode) {
        emit(code);
        define(previous, firstByte(code));
      } else if (code === nextCode) {
        // KwKwK: the code being defined is used in the same step.
        define(previous, firstByte(previous));
        emit(code);
      } else {
        throw new Error(`GIF stream referenced undefined code ${code}.`);
      }
      previous = code;
    }
  }
  return output;
}
