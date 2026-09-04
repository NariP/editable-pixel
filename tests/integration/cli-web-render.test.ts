import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createPixelDocument, serializePixelDocument } from "@editable-pixel/document";
import { decodePng } from "@editable-pixel/image-codec";
import { renderRgba } from "@editable-pixel/renderer";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const cli = fileURLToPath(new URL("../../packages/pixel-cli/dist/cli.js", import.meta.url));

describe("CLI and web renderer integration", () => {
  it("produces the same RGBA pixels as the Canvas renderer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editable-pixel-render-integration-"));
    try {
      const document = createPixelDocument({
        width: 2,
        height: 2,
        palette: ["#00000000", "#ff004dff"],
        pixels: [0, 1, 1, 0]
      });
      const input = join(directory, "asset.pixel.json");
      const output = join(directory, "asset.png");
      await writeFile(input, serializePixelDocument(document));

      await execFile(process.execPath, [cli, "render", input, "--output", output]);
      const decoded = await decodePng(await readFile(output));

      expect([...decoded.data]).toEqual([...renderRgba(document).data]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
