import { defineConfig } from "tsup";

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
