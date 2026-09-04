/**
 * WebAssembly image codecs plus the small raster helpers the pixel pipeline
 * needs. This replaces the native `sharp` dependency, whose prebuilt binaries
 * (`@img/*`) accounted for ~26 MB of every user install.
 *
 * `@jsquash/*` ships codecs only, so nearest-neighbour resizing, RGBA
 * compositing and format sniffing live here.
 */
export type ImageFormat = "png" | "jpeg" | "webp";

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DecodedImage extends RgbaImage {
  format: ImageFormat;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositeLayer {
  image: RgbaImage;
  left: number;
  top: number;
}

/**
 * Magic-byte sniffing. `sharp(buffer)` picked the decoder from the container
 * bytes; jSquash exposes one decoder per format, so the dispatch is ours.
 */
export function detectImageFormat(source: Uint8Array): ImageFormat | undefined {
  if (source.length >= 8
    && source[0] === 0x89 && source[1] === 0x50 && source[2] === 0x4e && source[3] === 0x47
    && source[4] === 0x0d && source[5] === 0x0a && source[6] === 0x1a && source[7] === 0x0a) {
    return "png";
  }
  if (source.length >= 3 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff) {
    return "jpeg";
  }
  if (source.length >= 12
    && source[0] === 0x52 && source[1] === 0x49 && source[2] === 0x46 && source[3] === 0x46
    && source[8] === 0x57 && source[9] === 0x45 && source[10] === 0x42 && source[11] === 0x50) {
    return "webp";
  }
  return undefined;
}

/**
 * Diagnostic suffix for the unsupported-format error. sharp reported the
 * container it sniffed; the leading bytes serve the same purpose here, telling
 * a truncated or empty file apart from a genuinely unsupported container such
 * as TIFF (`0x49492a00`), AVIF, or BMP.
 */
function describeContainer(source: Uint8Array): string {
  const magic = Array.from(source.subarray(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bytes = `received ${source.length} ${source.length === 1 ? "byte" : "bytes"}`;
  return magic ? `${bytes} starting 0x${magic}` : bytes;
}

export async function decodeImage(source: Uint8Array): Promise<DecodedImage> {
  const format = detectImageFormat(source);
  if (!format) {
    throw new Error(`Unsupported image format. Use PNG, WebP, or JPEG. (${describeContainer(source)})`);
  }
  const decoded = format === "png"
    ? await decodePng(source)
    : format === "jpeg"
      ? await decodeJpeg(source)
      : await decodeWebp(source);
  return { ...decoded, format };
}

export async function decodePng(source: Uint8Array): Promise<RgbaImage> {
  const decode = await loadPngDecoder();
  return toRgbaImage(await decode(toArrayBuffer(source)));
}

export async function decodeJpeg(source: Uint8Array): Promise<RgbaImage> {
  const decode = await loadJpegDecoder();
  return toRgbaImage(await decode(toArrayBuffer(source)));
}

export async function decodeWebp(source: Uint8Array): Promise<RgbaImage> {
  const decode = await loadWebpDecoder();
  return toRgbaImage(await decode(toArrayBuffer(source)));
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  assertDimensions(image);
  const encode = await loadPngEncoder();
  // The encoder reads `data.buffer`, so a view over a larger pool would leak
  // neighbouring bytes into the PNG. Hand it an exactly sized copy.
  const encoded = await encode({
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
    colorSpace: "srgb"
  });
  return new Uint8Array(encoded);
}

/**
 * Nearest-neighbour resampling with centre sampling, matching sharp's
 * `kernel: "nearest"` with `fit: "fill"` (aspect ratio is ignored; the source
 * is stretched onto the target box). For integer upscales — the only ratio the
 * renderer uses — this reduces to `floor(x / scale)`, so previews stay
 * byte-identical to the previous sharp output.
 */
export function resizeNearest(image: RgbaImage, width: number, height: number): RgbaImage {
  assertDimensions(image);
  assertDimensions({ width, height });
  if (width === image.width && height === image.height) {
    return { data: new Uint8ClampedArray(image.data), width, height };
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const columns = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    columns[x] = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / width));
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / height));
    const sourceRow = sourceY * image.width;
    const targetRow = y * width;
    for (let x = 0; x < width; x += 1) {
      const source = (sourceRow + columns[x]!) * 4;
      const target = (targetRow + x) * 4;
      data[target] = image.data[source]!;
      data[target + 1] = image.data[source + 1]!;
      data[target + 2] = image.data[source + 2]!;
      data[target + 3] = image.data[source + 3]!;
    }
  }
  return { data, width, height };
}

/**
 * Copies `input` into `target` at `rect`, clipping at the target edges.
 * Replaces sharp's `.composite()`; the pipeline only ever places
 * non-overlapping, fully opaque-or-transparent tiles, so this is a copy rather
 * than an alpha blend — which is what `composite` did for those inputs too.
 *
 * Sizes are validated up front: `sharp.composite()` threw on a raw buffer whose
 * length disagreed with its declared dimensions, whereas a bare `subarray`
 * would quietly return a short slice and paint only part of the tile.
 */
export function blitRgba(
  target: Uint8ClampedArray,
  targetWidth: number,
  input: Uint8ClampedArray,
  rect: Rectangle
): void {
  assertDimensions({ width: rect.width, height: rect.height });
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y)) {
    throw new RangeError(`Blit offset must be integers, received ${rect.x},${rect.y}.`);
  }
  const required = rect.width * rect.height * 4;
  if (input.length < required) {
    throw new RangeError(
      `Source buffer holds ${input.length} bytes but ${rect.width}x${rect.height} RGBA needs ${required}.`
    );
  }
  if (!Number.isInteger(targetWidth) || targetWidth < 1) {
    throw new RangeError(`Target width must be a positive integer, received ${targetWidth}.`);
  }
  const targetHeight = target.length / 4 / targetWidth;
  if (!Number.isInteger(targetHeight) || targetHeight < 1) {
    // Otherwise the `targetY >= targetHeight` bound below is meaningless and
    // rows could be written past the last complete scanline.
    throw new RangeError(
      `Target buffer holds ${target.length} bytes, which is not a whole number of ${targetWidth}px RGBA rows.`
    );
  }
  // Clip on both axes. Without the horizontal clamp an overhanging rect would
  // silently wrap into the next row rather than being cut off.
  const left = Math.max(0, rect.x);
  const right = Math.min(targetWidth, rect.x + rect.width);
  if (left >= right) return;
  const span = (right - left) * 4;

  for (let y = 0; y < rect.height; y += 1) {
    const targetY = rect.y + y;
    if (targetY < 0 || targetY >= targetHeight) continue;
    const sourceStart = (y * rect.width + (left - rect.x)) * 4;
    const targetStart = (targetY * targetWidth + left) * 4;
    target.set(input.subarray(sourceStart, sourceStart + span), targetStart);
  }
}

/** Replaces `sharp({ create }).composite([...])` for sprite-sheet assembly. */
export function compositeRgba(width: number, height: number, layers: CompositeLayer[]): RgbaImage {
  assertDimensions({ width, height });
  const data = new Uint8ClampedArray(width * height * 4);
  for (const layer of layers) {
    blitRgba(data, width, layer.image.data, {
      x: layer.left,
      y: layer.top,
      width: layer.image.width,
      height: layer.image.height
    });
  }
  return { data, width, height };
}

function assertDimensions({ width, height }: { width: number; height: number }): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Image dimensions must be positive integers, received ${width}x${height}.`);
  }
}

function toArrayBuffer(source: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function toRgbaImage(decoded: { data: Uint8ClampedArray; width: number; height: number }): RgbaImage {
  // jSquash decoders always return 8-bit RGBA, so `ensureAlpha()` is implicit.
  return { data: decoded.data, width: decoded.width, height: decoded.height };
}

/* -------------------------------------------------------------------------- */
/* wasm loading                                                               */
/* -------------------------------------------------------------------------- */

type PngDecode = (data: ArrayBuffer) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
type PngEncode = (data: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: "srgb";
}) => Promise<ArrayBuffer>;
type Decode = (data: ArrayBuffer) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;

let pngDecoder: Promise<PngDecode> | undefined;
let pngEncoder: Promise<PngEncode> | undefined;
let jpegDecoder: Promise<Decode> | undefined;
let webpDecoder: Promise<Decode> | undefined;

/**
 * Caches the initialised codec, but only on success. Keeping a rejected promise
 * would make one transient failure — an unlucky `readFile`, a partially written
 * install — permanent for the life of the process; clearing the slot lets the
 * next call retry. Concurrent callers still share a single in-flight init.
 */
function once<T>(
  read: () => Promise<T> | undefined,
  write: (value: Promise<T> | undefined) => void,
  load: () => Promise<T>
): Promise<T> {
  const cached = read();
  if (cached) return cached;
  const pending = load().catch((error: unknown) => {
    write(undefined);
    throw error;
  });
  write(pending);
  return pending;
}

async function loadPngDecoder(): Promise<PngDecode> {
  return once(() => pngDecoder, (value) => { pngDecoder = value; }, async () => {
    const module = await import("@jsquash/png/decode.js");
    await module.init(await compileWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
    return module.default as unknown as PngDecode;
  });
}

async function loadPngEncoder(): Promise<PngEncode> {
  return once(() => pngEncoder, (value) => { pngEncoder = value; }, async () => {
    const module = await import("@jsquash/png/encode.js");
    await module.init(await compileWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
    return module.default as unknown as PngEncode;
  });
}

async function loadJpegDecoder(): Promise<Decode> {
  return once(() => jpegDecoder, (value) => { jpegDecoder = value; }, async () => {
    const module = await import("@jsquash/jpeg/decode.js");
    await initEmscripten(module.init, "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm");
    return module.default as unknown as Decode;
  });
}

async function loadWebpDecoder(): Promise<Decode> {
  return once(() => webpDecoder, (value) => { webpDecoder = value; }, async () => {
    const module = await import("@jsquash/webp/decode.js");
    await initEmscripten(module.init, "@jsquash/webp/codec/dec/webp_dec.wasm");
    return module.default as unknown as Decode;
  });
}

/**
 * The Emscripten-backed decoders type `init` as taking module *option
 * overrides* only, but at runtime they branch on `module instanceof
 * WebAssembly.Module` — the documented Node path. Without it they would `fetch`
 * the wasm over a URL, which fails outside a browser.
 */
async function initEmscripten(
  init: (...args: never[]) => Promise<unknown>,
  specifier: string
): Promise<void> {
  await (init as unknown as (module: WebAssembly.Module) => Promise<unknown>)(await compileWasm(specifier));
}

/**
 * Resolves the codec wasm next to its JavaScript glue.
 *
 * Node's resolver is used rather than a hand-built path so that whatever layout
 * the installer produced works unchanged — pnpm's virtual store, npm's
 * flattened tree, or the bundled CLI, where `@jsquash/*` stays external and
 * lands in the published package's own `node_modules`. Nothing has to be copied
 * into our package. `createRequire` is preferred over `import.meta.resolve`
 * because bundlers and the Vitest transform rewrite the latter away.
 *
 * Note on the resolution anchor: the CLI bundle *inlines* this module, so
 * `import.meta.url` is the bundle's own URL and resolution starts from
 * `dist/` inside the published package rather than from this source file.
 * That is what makes `@jsquash/*` resolve against the installed package's
 * `node_modules` — see the matching `.catch()` fallback in
 * tests/distribution/package-install.mjs, which tolerates either the hoisted
 * or the nested layout.
 */
async function compileWasm(specifier: string): Promise<WebAssembly.Module> {
  const { readFile } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const resolve = createRequire(import.meta.url).resolve;
  return new WebAssembly.Module(await readFile(resolve(specifier)));
}
