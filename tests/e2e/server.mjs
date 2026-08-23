import { resolve } from "node:path";

import { startPixelServer } from "../../packages/pixel-server/dist/index.js";

const server = await startPixelServer({
  port: 4178,
  daemonToken: "editable-pixel-e2e-daemon-token",
  webDist: resolve("apps/web/dist")
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.stdin.resume();
