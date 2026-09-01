import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parsePixelDocument } from "@editable-pixel/document";
import { SessionStore } from "@editable-pixel/server";
import { describe, expect, it } from "vitest";

describe("read-only MCP evaluations", () => {
  it("keeps ten verified answers pinned to the committed evaluation fixture", async () => {
    const evaluationPath = fileURLToPath(new URL("../evaluations/read-only.xml", import.meta.url));
    const fixturePath = fileURLToPath(new URL("../../../tests/fixtures/character.pixel.json", import.meta.url));
    const [xml, fixture] = await Promise.all([
      readFile(evaluationPath, "utf8"),
      readFile(fixturePath, "utf8")
    ]);
    const expected = [...xml.matchAll(/<answer>([^<]+)<\/answer>/g)].map((match) => match[1]!);
    expect(expected).toHaveLength(10);

    const store = new SessionStore();
    const created = await store.create({ document: parsePixelDocument(fixture) });
    const metadata = store.getMetadata(created.session.id);
    const motion = store.getMotionContext(created.session.id).clips[0]!;
    const palette = store.getPaletteContext(created.session.id);
    const nonTransparent = palette.colors.filter((color) => !color.transparent);
    const mostUsed = nonTransparent.reduce((best, color) => color.usedPixels > best.usedPixels ? color : best);
    const onePixel = store.getDesignContext(created.session.id, {
      bounds: { x: 16, y: 20, width: 1, height: 1 },
      padding: 0
    });

    const actual = [
      metadata.document.id,
      String(metadata.document.frames.length),
      String(motion.durationMs),
      motion.frames.reduce((shortest, frame) => frame.durationMs < shortest.durationMs ? frame : shortest).name,
      String(mostUsed.index),
      mostUsed.rgba,
      String(palette.colors.filter((color) => color.usedPixels === 0).length),
      String(nonTransparent.reduce((total, color) => total + color.usedPixels, 0)),
      String(metadata.document.contentBounds.width * metadata.document.contentBounds.height),
      String(onePixel.colorIndices[0]![0])
    ];

    expect(actual).toEqual(expected);
  });
});
