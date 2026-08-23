#!/usr/bin/env node
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startPixelServer, writeRegistry } from "@editable-pixel/server";

const webDist = await findWebDist();
const server = await startPixelServer({ webDist });
await writeRegistry({
  pid: process.pid,
  port: server.port,
  daemonToken: server.daemonToken,
  startedAt: new Date().toISOString()
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.stdin.resume();

async function findWebDist(): Promise<string> {
  const candidates = [
    fileURLToPath(new URL("../web", import.meta.url)),
    fileURLToPath(new URL("../../../apps/web/dist", import.meta.url))
  ];
  for (const candidate of candidates) {
    try {
      await access(join(candidate, "index.html"));
      return candidate;
    } catch {
      // Try the repository and packaged layouts in order.
    }
  }
  throw new Error("Built web editor not found. Run `pnpm build` before starting the server.");
}
