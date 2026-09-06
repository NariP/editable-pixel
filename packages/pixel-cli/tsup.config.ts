import { readFileSync } from "node:fs";

import { defineConfig } from "tsup";

/**
 * Single source of truth for the shipped version. `--version` output and the MCP
 * handshake's `serverInfo.version` both used to carry their own string literal,
 * so a release could ship a stale value with nothing reading it back.
 *
 * `define` substitutes the canonical manifest version textually, which reaches
 * `packages/pixel-mcp` too: that package is not in `external`, so tsup inlines it
 * into this bundle and the free identifier in its `tsc` output is substituted
 * along with the CLI's own. Sources fall back to reading this same manifest when
 * they run unbundled — see `src/version.ts`.
 */
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "server-runner": "src/server-runner.ts",
    mcp: "src/mcp.ts"
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  define: { __EDITABLE_PIXEL_VERSION__: JSON.stringify(version) },
  splitting: false,
  sourcemap: true,
  clean: true,
  // @jsquash/* stay external: their wasm is resolved next to the codec glue at
  // runtime, and tsup would neither bundle nor relocate the .wasm files.
  external: [
    "@jsquash/jpeg/decode.js",
    "@jsquash/png/decode.js",
    "@jsquash/png/encode.js",
    "@jsquash/webp/decode.js",
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/stdio",
    "busboy",
    "commander",
    "cross-spawn",
    "open",
    "ws",
    "zod",
    "zod/v4"
  ]
});
