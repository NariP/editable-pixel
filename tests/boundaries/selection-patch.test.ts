import { applyPatch, createPixelPatch, getPixels } from "@editable-pixel/core";
import { createPixelDocument, type Selection } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";

describe("selection patch boundary", () => {
  it("rejects creation outside the selection and detects later outside changes", () => {
    const document = createPixelDocument({ width: 4, height: 4 });
    const selection: Selection = {
      type: "rect", x: 1, y: 1, width: 2, height: 2, layerId: "artwork", frameId: "frame-1"
    };
    const pixels = getPixels(document, "artwork", "frame-1");

    expect(() => createPixelPatch(document, "artwork", "frame-1", [
      { index: 0, before: pixels[0]!, after: 1 }
    ], selection, "outside"))
      .toThrow("outside the selection");

    const patch = createPixelPatch(document, "artwork", "frame-1", [
      { index: 5, before: pixels[5]!, after: 1 }
    ], selection, "inside");
    const tampered = structuredClone(document);
    tampered.layers[0]!.frames["frame-1"]![0] = 1;

    expect(() => applyPatch(tampered, patch)).toThrow("outside the selection changed");
  });
});
