import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The single canonical version lives in `packages/pixel-cli/package.json`. Two
 * shipped surfaces have to repeat it — `--version` output and the MCP handshake
 * — and both are string literals with nothing reading them back, so a stale
 * value used to ship silently.
 *
 * `__EDITABLE_PIXEL_VERSION__` is substituted by tsup's `define` at build time
 * (see `tsup.config.ts`), which is the only path that reaches a published
 * artifact. Unbundled consumers — vitest importing this source directly,
 * `tsx`/`node --experimental-strip-types` during development — never see the
 * substitution, so they fall back to reading the canonical manifest off disk.
 *
 * The fallback deliberately has no `?? "0.0.0"` and no empty-string default: a
 * version we cannot resolve must throw here rather than reach a user as
 * `undefined` in `--version` output or as a malformed MCP handshake.
 */
declare const __EDITABLE_PIXEL_VERSION__: string | undefined;

const manifestUrl = new URL("../package.json", import.meta.url);

const readCanonicalVersion = (): string => {
  const { version } = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")) as { version?: unknown };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`editable-pixel: no usable version in ${fileURLToPath(manifestUrl)}`);
  }
  return version;
};

export const resolveVersion = (injected: string | undefined): string =>
  typeof injected === "string" && injected.length > 0 ? injected : readCanonicalVersion();

export const packageVersion = resolveVersion(
  typeof __EDITABLE_PIXEL_VERSION__ === "string" ? __EDITABLE_PIXEL_VERSION__ : undefined
);
