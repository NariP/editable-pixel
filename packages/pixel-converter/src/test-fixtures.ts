/**
 * Test-only encoders. The converter itself never writes WebP or JPEG — it only
 * decodes them — so these live outside the shipped codec surface and exist
 * purely to build the fixtures the decode tests feed back in.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export async function encodeLosslessWebp(image: RawImage): Promise<Buffer> {
  const module = await import("@jsquash/webp/encode.js");
  await initWithWasm(module.init, "@jsquash/webp/codec/enc/webp_enc.wasm");
  return Buffer.from(await module.default(toImageData(image), { lossless: 1 }));
}

export async function encodeLosslessJpeg(image: RawImage): Promise<Buffer> {
  const module = await import("@jsquash/jpeg/encode.js");
  await initWithWasm(module.init, "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm");
  // Quality 100 with 4:4:4 chroma keeps the fixture colours addressable after
  // the lossy round trip, matching the previous sharp fixture settings.
  return Buffer.from(await module.default(toImageData(image), {
    quality: 100,
    chroma_subsample: 1
  } as Parameters<typeof module.default>[1]));
}

function toImageData(image: RawImage): ImageData {
  return { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height } as ImageData;
}

async function initWithWasm(
  init: (...args: never[]) => Promise<unknown>,
  specifier: string
): Promise<void> {
  // Node's resolver, not `import.meta.resolve`, which the Vitest transform strips.
  const wasm = new WebAssembly.Module(await readFile(createRequire(import.meta.url).resolve(specifier)));
  await (init as unknown as (module: WebAssembly.Module) => Promise<unknown>)(wasm);
}
