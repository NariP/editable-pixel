import type * as FsPromises from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Codec initialisation is cached in a module-level singleton. This suite pins
 * the one property that is easy to lose: a *failed* init must not be cached, or
 * a single transient filesystem hiccup would disable the decoder for the rest
 * of the process.
 *
 * It lives apart from index.test.ts because it mocks `node:fs/promises` — the
 * source of the wasm bytes — and resets the module registry per test so each
 * case starts from a cold cache.
 */
const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile }));

const PIXEL = { data: new Uint8ClampedArray([12, 34, 56, 255]), width: 1, height: 1 };

// The bare specifier now resolves to the mock, so the real implementation has
// to come from importActual.
let readFileActual: typeof FsPromises.readFile;

describe("codec initialisation caching", () => {
  beforeAll(async () => {
    ({ readFile: readFileActual } = await vi.importActual<typeof FsPromises>("node:fs/promises"));
  });

  beforeEach(() => {
    vi.resetModules();
    readFile.mockReset();
    readFile.mockImplementation(readFileActual);
  });

  it("retries after a transient wasm read failure instead of caching the rejection", async () => {
    const { decodePng, encodePng } = await import("./index.js");
    const png = await encodePng(PIXEL);

    // Cold decoder cache: fail its first wasm read, then let it through.
    readFile.mockRejectedValueOnce(Object.assign(new Error("EIO: simulated"), { code: "EIO" }));

    await expect(decodePng(png)).rejects.toThrow("EIO: simulated");

    // The rejection must not be cached: this call re-reads and succeeds.
    const decoded = await decodePng(png);

    expect(decoded.width).toBe(1);
    expect([...decoded.data]).toEqual([12, 34, 56, 255]);
  });

  it("shares one in-flight initialisation between concurrent callers", async () => {
    const { decodePng, encodePng } = await import("./index.js");
    const png = await encodePng(PIXEL);
    const before = readFile.mock.calls.length;

    // Two concurrent decodes must compile the decoder wasm once, not twice.
    const [first, second] = await Promise.all([decodePng(png), decodePng(png)]);

    expect(readFile.mock.calls.length - before).toBe(1);
    expect([...first.data]).toEqual([...second.data]);
  });
});
