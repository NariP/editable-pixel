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
  external: [
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server/stdio",
    "busboy",
    "commander",
    "open",
    "sharp",
    "ws",
    "zod",
    "zod/v4"
  ]
});
