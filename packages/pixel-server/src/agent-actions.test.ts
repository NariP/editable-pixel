import { createPixelDocument } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";

import { createSelection, type SelectionCommand } from "./agent-actions.js";

const target = { layerId: "artwork", frameId: "frame-1" };
const diamond = { type: "isometric_diamond", centerX: 4, centerY: 2, width: 8 } as const;

describe("isometric diamond selections", () => {
  it("selects exact pixel centers with a default 2:1 ratio and preserves the document", () => {
    const document = createPixelDocument({ width: 8, height: 4 });
    const before = structuredClone(document);
    expect(createSelection(document, diamond, target)).toEqual({
      type: "mask", x: 1, y: 0, width: 6, height: 4, ...target,
      indices: [3, 4, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 27, 28]
    });
    expect(document).toEqual(before);
    expect(createSelection(document, { ...diamond, width: 5 }, target)).toEqual(
      createSelection(document, { ...diamond, width: 5, height: 3 }, target)
    );
  });

  it("clips a partially visible diamond to the canvas", () => {
    const document = createPixelDocument({ width: 8, height: 4 });
    expect(createSelection(document, { ...diamond, centerX: 0, centerY: 0 }, target)).toEqual({
      type: "mask", x: 0, y: 0, width: 3, height: 2, ...target, indices: [0, 1, 2, 8]
    });
  });

  it("supports add, remove, and toggle without affecting other selected pixels", () => {
    const document = createPixelDocument({ width: 8, height: 4 });
    document.selection = { type: "rect", x: 0, y: 0, width: 1, height: 1, ...target };
    document.selection = createSelection(document, { ...diamond, mode: "add" }, target);
    expect(document.selection).toHaveProperty("indices", [0, 3, 4, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 27, 28]);
    expect(createSelection(document, { ...diamond, mode: "remove" }, target)).toEqual({
      type: "rect", x: 0, y: 0, width: 1, height: 1, ...target
    });
    expect(createSelection(document, { ...diamond, mode: "toggle" }, target)).toEqual(
      createSelection(document, { ...diamond, mode: "remove" }, target)
    );
    document.selection = createSelection(document, diamond, target);
    expect(createSelection(document, { ...diamond, mode: "toggle" }, target)).toBeUndefined();
  });

  it.each([
    { centerX: -1 }, { centerY: 4096 }, { centerX: 1.5 }, { centerY: NaN },
    { width: 0 }, { width: Infinity }, { height: -1 }, { height: 2.5 }, { height: 4097 },
    { mode: "invalid" }, { frameId: "missing" }, { layerId: "missing" },
    { centerX: 99, centerY: 99 }
  ])("rejects invalid or nonintersecting requests: %j", (override) => {
    const document = createPixelDocument({ width: 8, height: 4 });
    expect(() => createSelection(document, { ...diamond, ...override } as SelectionCommand, target)).toThrow();
    expect(document.selection).toBeUndefined();
    expect(document.revision).toBe(0);
  });

  it("enforces the selection size limit before allocating a full large diamond", () => {
    const document = createPixelDocument({ width: 1024, height: 512 });
    expect(() => createSelection(document, {
      ...diamond, centerX: 512, centerY: 256, width: 1024
    }, target)).toThrow("100,000 pixel");
  });
});
