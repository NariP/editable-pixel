#!/usr/bin/env node
import { appendFileSync } from "node:fs";

// A fixture, never a real Codex/Claude configuration writer.
const args = process.argv.slice(2);
appendFileSync(process.env.EDITABLE_PIXEL_TEST_HOST_LOG, `${JSON.stringify(args)}\n`);
if (args[0] === "--version") {
  process.stdout.write("fixture-host 1.0.0\n");
  process.exit(process.env.EDITABLE_PIXEL_TEST_HOST_MISSING === "1" ? 1 : 0);
}
if (args[0] === "mcp" && args[1] === "get") {
  process.exit(process.env.EDITABLE_PIXEL_TEST_HOST_REGISTERED === "1" ? 0 : 1);
}
if (args[0] === "mcp" && ["add", "remove"].includes(args[1])) process.exit(0);
process.exit(2);
