import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Mirror of `packages/pixel-cli/src/version.ts` for the MCP handshake's
 * `serverInfo.version`.
 *
 * This package is private and pinned at `0.0.0`; the version users see is the
 * published `editable-pixel` CLI version, because `packages/pixel-cli/src/mcp.ts`
 * imports this module and tsup inlines it into the shipped `dist/mcp.js`. So the
 * canonical manifest is the CLI's, not this package's.
 *
 * `__EDITABLE_PIXEL_VERSION__` is substituted by the CLI's tsup `define`. That
 * substitution survives this package's own `tsc` build because tsc leaves the
 * free identifier untouched in `dist/index.js`, which is what tsup actually
 * bundles.
 *
 * The disk fallback covers unbundled use — vitest importing this source, or the
 * `tsc` output run directly. `../package.json` resolves to this package's
 * manifest from both `src/` and `dist/`, which is the wrong (`0.0.0`) value, so
 * the path deliberately reaches across to the CLI package instead.
 *
 * A version that cannot be resolved throws rather than handing `undefined` to
 * the MCP handshake, where a malformed `serverInfo` fails opaquely on the client.
 */
declare const __EDITABLE_PIXEL_VERSION__: string | undefined;

const manifestUrl = new URL("../../pixel-cli/package.json", import.meta.url);

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
