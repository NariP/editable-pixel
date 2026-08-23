import { convertImage } from "@editable-pixel/converter";
import { createPixelDocument } from "@editable-pixel/document";
import { renderPng } from "@editable-pixel/renderer/node";
import { describe, expect, it } from "vitest";

describe("conversion and rendering round trip", () => {
  it("reimports a logical PNG with identical palette indices and rendered bytes", async () => {
    const source = createPixelDocument({
      width: 4,
      height: 3,
      palette: ["#00000000", "#171a17ff", "#ff5c35ff"],
      pixels: [0, 1, 1, 0, 1, 2, 2, 1, 0, 1, 1, 0]
    });
    const png = await renderPng(source);
    const converted = await convertImage(png, {
      canvasWidth: 4,
      canvasHeight: 3,
      contentScale: 1,
      contentBox: { x: 0, y: 0, width: 4, height: 3 },
      palette: source.palette,
      dithering: "none"
    });

    expect(converted.document.layers[0]!.frames["frame-1"]).toEqual(
      source.layers[0]!.frames["frame-1"]
    );
    expect(await renderPng(converted.document)).toEqual(png);
  });
});
