import { createPixelDocument, type Selection } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";

import {
  PatchConflictError,
  PatchHistory,
  addPaletteColor,
  addRegion,
  addFrame,
  addLayer,
  applyPatch,
  clearSelection,
  copySelection,
  createPalettePixelPatch,
  drawLine,
  duplicateFrame,
  duplicateLayer,
  erasePixel,
  fill,
  flipSelection,
  getPixels,
  mergePaletteColors,
  moveSelection,
  pasteLayer,
  removeFrame,
  removeLayer,
  removePaletteColor,
  removeRegion,
  reorderFrame,
  reorderLayer,
  reorderPaletteColor,
  renameFrame,
  renameLayer,
  replaceColor,
  resizeCanvas,
  resizeContent,
  setFrameDuration,
  setLayerVisibility,
  setLayerOpacity,
  setPixel,
  updateRegion
} from "./index.js";

const selection: Selection = {
  type: "rect",
  x: 1,
  y: 1,
  width: 2,
  height: 2,
  layerId: "artwork",
  frameId: "frame-1"
};

describe("Pixel Core", () => {
  it("applies a bounded patch without changing pixels outside the selection", () => {
    const document = createPixelDocument({ width: 4, height: 4 });
    const patch = setPixel(document, "artwork", "frame-1", 1, 1, 1, selection);
    const next = applyPatch(document, patch);

    expect(getPixels(next, "artwork", "frame-1")[5]).toBe(1);
    expect(getPixels(next, "artwork", "frame-1").filter((pixel) => pixel === 1)).toHaveLength(1);
    expect(next.revision).toBe(1);
  });

  it("refuses to build a bounded patch that escapes the selection", () => {
    const document = createPixelDocument({ width: 4, height: 4 });

    expect(() => setPixel(document, "artwork", "frame-1", 0, 0, 1, selection)).toThrow(
      "outside the selection"
    );

    const patch = setPixel(document, "artwork", "frame-1", 1, 1, 1, selection);
    patch.changes[0]!.index = 0;
    expect(() => applyPatch(document, patch)).toThrow("outside the selection");
  });

  it("adds a palette color and paints only inside the active selection atomically", () => {
    const document = createPixelDocument({ width: 4, height: 4 });
    const newIndex = document.palette.length;
    const before = [...getPixels(document, "artwork", "frame-1")];
    const patch = createPalettePixelPatch(
      document,
      "artwork",
      "frame-1",
      ["#7c3aedff"],
      [{ index: 5, before: before[5]!, after: newIndex }],
      selection,
      "Add violet inside selection"
    );
    const next = applyPatch(document, patch);

    expect(next.palette[newIndex]).toBe("#7c3aedff");
    expect(getPixels(next, "artwork", "frame-1")[5]).toBe(newIndex);
    expect(getPixels(next, "artwork", "frame-1").filter((pixel, index) => index !== 5 && pixel !== before[index])).toEqual([]);
    expect(() => createPalettePixelPatch(
      document,
      "artwork",
      "frame-1",
      ["#7c3aedff"],
      [{ index: 0, before: before[0]!, after: newIndex }],
      selection,
      "Escape selection"
    )).toThrow("outside the selection");
  });

  it("rejects stale revisions", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const patch = setPixel(document, "artwork", "frame-1", 0, 0, 1);
    const next = applyPatch(document, patch);

    expect(() => applyPatch(next, patch)).toThrow(PatchConflictError);
  });

  it("fills connected pixels and respects the selection boundary", () => {
    const document = createPixelDocument({ width: 4, height: 4 });
    const patch = fill(document, "artwork", "frame-1", 1, 1, 1, selection);
    const next = applyPatch(document, patch);

    expect(getPixels(next, "artwork", "frame-1").filter((pixel) => pixel === 1)).toHaveLength(4);
  });

  it("clears and replaces colors within a selection", () => {
    const document = createPixelDocument({
      width: 4,
      height: 4,
      palette: ["#00000000", "#ffffffff", "#ff004dff"],
      pixels: Array.from({ length: 16 }, () => 1)
    });
    const replaced = applyPatch(document, replaceColor(document, "artwork", "frame-1", 1, 2, selection));
    const cleared = applyPatch(replaced, clearSelection(replaced, selection));

    expect(getPixels(cleared, "artwork", "frame-1").filter((pixel) => pixel === 0)).toHaveLength(4);
    expect(getPixels(cleared, "artwork", "frame-1").filter((pixel) => pixel === 1)).toHaveLength(12);
  });

  it("treats sparse color masks as real bounded selections", () => {
    const document = createPixelDocument({
      width: 3,
      height: 3,
      palette: ["#00000000", "#ffffffff"],
      pixels: Array(9).fill(1)
    });
    const mask: Selection = {
      type: "mask",
      x: 0,
      y: 0,
      width: 3,
      height: 3,
      layerId: "artwork",
      frameId: "frame-1",
      indices: [0, 2, 4, 6, 8]
    };

    expect(() => setPixel(document, "artwork", "frame-1", 1, 0, 1, mask)).toThrow("outside the selection");
    const cleared = applyPatch(document, clearSelection(document, mask));
    expect(getPixels(cleared, "artwork", "frame-1")).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it("supports undo and redo", () => {
    const history = new PatchHistory();
    const document = createPixelDocument({ width: 2, height: 2 });
    const changed = history.apply(document, setPixel(document, "artwork", "frame-1", 0, 0, 1));
    const undone = history.undo(changed);
    const redone = history.redo(undone);

    expect(getPixels(undone, "artwork", "frame-1")[0]).toBe(0);
    expect(getPixels(redone, "artwork", "frame-1")[0]).toBe(1);
  });

  it("models layer and frame changes as document patches", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const withLayer = applyPatch(document, addLayer(document, "Shadow"));
    const withFrame = applyPatch(withLayer, addFrame(withLayer, "Frame 2"));

    expect(withLayer.layers).toHaveLength(2);
    expect(withFrame.frames).toHaveLength(2);
    expect(Object.keys(withFrame.layers[1]!.frames)).toHaveLength(2);
  });

  it("resizes the canvas around a stable anchor", () => {
    const document = createPixelDocument({ width: 2, height: 2, pixels: [1, 0, 0, 0] });
    const resized = applyPatch(document, resizeCanvas(document, 4, 4, "center"));

    expect(resized.canvas).toEqual({ width: 4, height: 4 });
    expect(getPixels(resized, "artwork", "frame-1")[5]).toBe(1);
    expect(resized.pivot).toEqual({ x: 2, y: 2 });
  });

  it("resizes content with nearest-neighbor sampling", () => {
    const document = createPixelDocument({ width: 4, height: 4, pixels: [1, 0, 0, 0, ...Array(12).fill(0)] });
    const resized = applyPatch(
      document,
      resizeContent(document, { x: 1, y: 1, width: 2, height: 2 })
    );

    expect(getPixels(resized, "artwork", "frame-1").filter((pixel) => pixel === 1)).toHaveLength(4);
    expect(resized.contentBox).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it("remaps pixels when palette colors are merged and reordered", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ff0000ff", "#00ff00ff"],
      pixels: [1, 2]
    });
    const merged = applyPatch(document, mergePaletteColors(document, 1, 2));
    const added = applyPatch(merged, addPaletteColor(merged, "#0000ffff"));
    const reordered = applyPatch(added, reorderPaletteColor(added, 2, 1));

    expect(merged.palette).toEqual(["#00000000", "#00ff00ff"]);
    expect(getPixels(merged, "artwork", "frame-1")).toEqual([1, 1]);
    expect(reordered.palette).toEqual(["#00000000", "#0000ffff", "#00ff00ff"]);
    expect(getPixels(reordered, "artwork", "frame-1")).toEqual([2, 2]);
  });

  it("manages frame order, layer opacity, and named regions", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const framed = applyPatch(document, addFrame(document, "Second"));
    const reordered = applyPatch(framed, reorderFrame(framed, framed.frames[1]!.id, 0));
    const faded = applyPatch(reordered, setLayerOpacity(reordered, "artwork", 0.5));
    const regioned = applyPatch(
      faded,
      addRegion(faded, {
        name: "Face",
        layerId: "artwork",
        frameId: "frame-1",
        bounds: { x: 0, y: 0, width: 1, height: 1 }
      })
    );

    expect(reordered.frames[0]!.name).toBe("Second");
    expect(faded.layers[0]!.opacity).toBe(0.5);
    expect(regioned.regions[0]).toMatchObject({ id: "region", name: "Face" });
  });

  it("draws, erases, moves, copies, and flips selected pixels", () => {
    const base = createPixelDocument({
      width: 3,
      height: 2,
      palette: ["#00000000", "#ff0000ff", "#0000ffff"],
      pixels: [1, 2, 0, 0, 0, 0]
    });
    const top: Selection = { ...selection, x: 0, y: 0, width: 2, height: 1 };
    const flipped = applyPatch(base, flipSelection(base, top, "horizontal"));
    const copied = applyPatch(flipped, copySelection(flipped, top, 0, 1));
    const moved = applyPatch(base, moveSelection(base, top, 0, 1));
    const lined = applyPatch(base, drawLine(base, "artwork", "frame-1", { x: 0, y: 1 }, { x: 2, y: 1 }, 1));
    const erased = applyPatch(lined, erasePixel(lined, "artwork", "frame-1", 1, 1));

    expect(getPixels(flipped, "artwork", "frame-1").slice(0, 2)).toEqual([2, 1]);
    expect(getPixels(copied, "artwork", "frame-1")).toEqual([2, 1, 0, 2, 1, 0]);
    expect(getPixels(moved, "artwork", "frame-1")).toEqual([0, 0, 0, 1, 2, 0]);
    expect(moved.selection).toMatchObject({ x: 0, y: 1, width: 2, height: 1 });
    expect(() => moveSelection(base, top, -1, 0)).toThrow("Selection cannot move outside the canvas");
    expect(getPixels(erased, "artwork", "frame-1").slice(3)).toEqual([1, 0, 1]);
  });

  it("moves sparse selection coordinates with their pixels", () => {
    const document = createPixelDocument({
      width: 3,
      height: 3,
      palette: ["#00000000", "#ffffffff", "#ff004dff"],
      pixels: [1, 0, 0, 0, 2, 0, 0, 0, 0]
    });
    const mask: Selection = {
      type: "mask",
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      layerId: "artwork",
      frameId: "frame-1",
      indices: [0, 4]
    };
    const moved = applyPatch(document, moveSelection(document, mask, 1, 0));

    expect(getPixels(moved, "artwork", "frame-1")).toEqual([0, 1, 0, 0, 0, 2, 0, 0, 0]);
    expect(moved.selection).toEqual({ ...mask, x: 1, indices: [1, 5] });
  });

  it("undoes and redoes moved pixels with their selection coordinates", () => {
    const history = new PatchHistory();
    const document = createPixelDocument({
      width: 2,
      height: 2,
      palette: ["#00000000", "#ffffffff"],
      pixels: [1, 0, 0, 0]
    });
    document.selection = {
      type: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layerId: "artwork",
      frameId: "frame-1"
    };
    const moved = history.apply(document, moveSelection(document, document.selection, 0, 1));
    const undone = history.undo(moved);
    const redone = history.redo(undone);

    expect(getPixels(moved, "artwork", "frame-1")).toEqual([0, 0, 1, 0]);
    expect(moved.selection?.y).toBe(1);
    expect(getPixels(undone, "artwork", "frame-1")).toEqual([1, 0, 0, 0]);
    expect(undone.selection?.y).toBe(0);
    expect(getPixels(redone, "artwork", "frame-1")).toEqual([0, 0, 1, 0]);
    expect(redone.selection?.y).toBe(1);
  });

  it("duplicates, reorders, toggles, and removes layers and frames", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const withLayer = applyPatch(document, addLayer(document, "Shadow"));
    const duplicatedLayer = applyPatch(withLayer, duplicateLayer(withLayer, "artwork"));
    const copyId = duplicatedLayer.layers[2]!.id;
    const reorderedLayer = applyPatch(duplicatedLayer, reorderLayer(duplicatedLayer, copyId, 0));
    const renamedLayer = applyPatch(reorderedLayer, renameLayer(reorderedLayer, copyId, "Highlights"));
    const hiddenLayer = applyPatch(renamedLayer, setLayerVisibility(renamedLayer, copyId, false));
    const withoutShadow = applyPatch(hiddenLayer, removeLayer(hiddenLayer, "layer"));

    const withFrame = applyPatch(withoutShadow, addFrame(withoutShadow, "Second"));
    const secondId = withFrame.frames[1]!.id;
    const duplicatedFrame = applyPatch(withFrame, duplicateFrame(withFrame, "frame-1"));
    const copyFrameId = duplicatedFrame.frames[2]!.id;
    const renamedFrame = applyPatch(duplicatedFrame, renameFrame(duplicatedFrame, copyFrameId, "Blink"));
    const timed = applyPatch(renamedFrame, setFrameDuration(renamedFrame, copyFrameId, 250));
    const withoutSecond = applyPatch(timed, removeFrame(timed, secondId));

    expect(withoutShadow.layers.map((layer) => layer.id)).toEqual([copyId, "artwork"]);
    expect(withoutShadow.layers[0]!.name).toBe("Highlights");
    expect(withoutShadow.layers[0]!.visible).toBe(false);
    expect(withoutSecond.frames.map((frame) => frame.id)).toEqual(["frame-1", copyFrameId]);
    expect(withoutSecond.frames[1]!.name).toBe("Blink");
    expect(withoutSecond.frames[1]!.durationMs).toBe(250);
  });

  it("pastes a copied layer snapshot after its source is removed", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const withLayer = applyPatch(document, addLayer(document, "Shadow"));
    const snapshot = structuredClone(withLayer.layers[1]!);
    const withoutSource = applyPatch(withLayer, removeLayer(withLayer, snapshot.id));
    const pasted = applyPatch(withoutSource, pasteLayer(withoutSource, snapshot));

    expect(pasted.layers).toHaveLength(2);
    expect(pasted.layers[1]!.id).toBe("layer-copy");
    expect(pasted.layers[1]!.name).toBe("Shadow copy");
    expect(pasted.layers[1]!.frames).toEqual(snapshot.frames);
  });

  it("removes palette entries and updates then removes named regions", () => {
    const document = createPixelDocument({
      width: 2,
      height: 1,
      palette: ["#00000000", "#ff0000ff", "#0000ffff"],
      pixels: [1, 2]
    });
    const paletteReduced = applyPatch(document, removePaletteColor(document, 1, 2));
    const regioned = applyPatch(
      paletteReduced,
      addRegion(paletteReduced, {
        name: "Face", layerId: "artwork", frameId: "frame-1", bounds: { x: 0, y: 0, width: 1, height: 1 }
      })
    );
    const updated = applyPatch(regioned, updateRegion(regioned, "region", {
      name: "Eyes", bounds: { x: 0, y: 0, width: 2, height: 1 }
    }));
    const removed = applyPatch(updated, removeRegion(updated, "region"));

    expect(paletteReduced.palette).toEqual(["#00000000", "#0000ffff"]);
    expect(getPixels(paletteReduced, "artwork", "frame-1")).toEqual([1, 1]);
    expect(updated.regions[0]).toMatchObject({ name: "Eyes", bounds: { width: 2 } });
    expect(removed.regions).toEqual([]);
  });
});
