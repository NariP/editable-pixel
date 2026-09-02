import { createPixelDocument } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";

import { isometricGridPath, renderOnionSkinRgba } from "./PixelCanvas.js";

describe("isometric grid", () => {
  it("builds both 2:1 diagonal line families with separate major guides", () => {
    const minor = isometricGridPath(32, 32, false);
    const major = isometricGridPath(32, 32, true);

    expect(minor).toContain("M 0 8 L 32 24");
    expect(minor).toContain("M 0 8 L 32 -8");
    expect(major).toContain("M 0 0 L 32 16");
    expect(major).toContain("M 0 0 L 32 -16");
  });
});

describe("onion skin rendering", () => {
  it("tints the previous frame orange without including the active frame", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ffffffff"],
      pixels: [1, 0]
    });
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 100 });
    document.layers[0]!.frames["frame-2"] = [0, 1];

    const pixels = renderOnionSkinRgba(document, "frame-2", {
      previous: 1,
      next: 0,
      opacity: 0.5
    });

    expect([...pixels.slice(0, 4)]).toEqual([255, 92, 53, 128]);
    expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it("tints the next frame cyan and returns a clear overlay when both directions are off", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ffffffff"],
      pixels: [1, 0]
    });
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 100 });
    document.layers[0]!.frames["frame-2"] = [0, 1];

    const nextPixels = renderOnionSkinRgba(document, "frame-1", {
      previous: 0,
      next: 1,
      opacity: 0.25
    });
    const disabledPixels = renderOnionSkinRgba(document, "frame-1", {
      previous: 0,
      next: 0,
      opacity: 0.5
    });

    expect([...nextPixels.slice(4, 8)]).toEqual([42, 211, 235, 64]);
    expect([...disabledPixels]).toEqual(new Array(8).fill(0));
  });
});
