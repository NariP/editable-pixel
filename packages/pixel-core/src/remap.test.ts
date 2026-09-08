import { createPixelDocument } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";
import { applyPatch, createRemapColorsPatch, resizeContent } from "./index.js";

const target = { targets: [{ layerId: "artwork", frameId: "frame-1" }] };
const colors = ["#00000000", "#ff0000ff", "#00ff00ff", "#0000ffff"];

describe("frozen color mappings", () => {
  it("swaps and chains from original pixels, reuses RGBA, and protects mask holes, layers and frames", () => {
    const document = createPixelDocument({ width: 4, height: 1, palette: colors, pixels: [1, 2, 1, 3] });
    document.frames.push({ id: "other", name: "Other", durationMs: 100 });
    document.layers[0]!.frames.other = [1, 2, 1, 3];
    document.layers.push({ ...structuredClone(document.layers[0]!), id: "protected" });
    document.selection = { type: "mask", layerId: "artwork", frameId: "frame-1", x: 0, y: 0, width: 4, height: 1, indices: [0, 1, 3] };
    const swapped = createRemapColorsPatch(document, { selectionOnly: true, mappings: [
      { id: "a", fromColorIndex: 1, toColor: colors[2] }, { id: "b", fromColorIndex: 2, toColor: colors[1] }
    ] }, "swap");
    const next = applyPatch(document, swapped.patch);
    expect(next.layers[0]!.frames["frame-1"]).toEqual([2, 1, 1, 3]);
    expect(next.layers[0]!.frames.other).toEqual(document.layers[0]!.frames.other);
    expect(next.layers[1]).toEqual(document.layers[1]);
    expect(next.palette).toEqual(colors);
    const chained = createRemapColorsPatch(document, { ...target, mappings: [
      { id: "a", fromColorIndex: 1, toColor: colors[2] }, { id: "b", fromColorIndex: 2, toColor: colors[3] }
    ] }, "chain");
    expect(chained.patch.after.layers[0]!.frames["frame-1"]).toEqual([2, 3, 2, 3]);
  });

  it("updates expanded and contracted alpha bounds before resizing content", () => {
    const document = createPixelDocument({ width: 3, height: 1, palette: colors, pixels: [0, 1, 0] });
    const expanded = applyPatch(document, createRemapColorsPatch(document, { ...target, mappings: [
      { id: "background", fromColorIndex: 0, toColor: colors[2] }
    ] }, "expand").patch);
    expect(expanded.contentBounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    const resized = applyPatch(expanded, resizeContent(expanded, { x: 0, y: 0, width: 3, height: 1 }));
    expect(resized.layers[0]!.frames["frame-1"]).toEqual([2, 1, 2]);
    const contracted = applyPatch(expanded, createRemapColorsPatch(expanded, { ...target, mappings: [
      { id: "background", fromColorIndex: 2, toColor: colors[0] }
    ] }, "contract").patch);
    expect(contracted.contentBounds).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    const enlarged = applyPatch(contracted, resizeContent(contracted, { x: 0, y: 0, width: 3, height: 1 }));
    expect(enlarged.layers[0]!.frames["frame-1"]).toEqual([1, 1, 1]);
  });

  it("applies fourteen valid mappings, identifies two failures, and retries only failed mappings", () => {
    const palette = [colors[0]!, ...Array.from({ length: 16 }, (_, index) => `#${(index + 1).toString(16).padStart(2, "0")}0000ff`)];
    const document = createPixelDocument({ width: 16, height: 1, palette, pixels: Array.from({ length: 16 }, (_, index) => index + 1) });
    const mappings = palette.slice(1).map((_, index) => ({ id: `shade-${index}`, fromColorIndex: index + 1, toColor: index < 14 ? "#112233ff" : "invalid" }));
    const result = createRemapColorsPatch(document, { ...target, mappings }, "partial");
    expect(result.results.filter((item) => item.status === "applied")).toHaveLength(14);
    expect(result.results.filter((item) => item.status === "failed").map(({ id, code }) => ({ id, code }))).toEqual([
      { id: "shade-14", code: "INVALID_COLOR" }, { id: "shade-15", code: "INVALID_COLOR" }
    ]);
    expect(result.patch.after.palette).toHaveLength(18);
    expect(result.patch.after.layers[0]!.frames["frame-1"]!.slice(-2)).toEqual([15, 16]);
    const retried = createRemapColorsPatch(applyPatch(document, result.patch), { ...target, mappings: mappings.slice(14).map((mapping) => ({ ...mapping, toColor: "#112233ff" })) }, "retry");
    expect(retried.changedPixels).toBe(2);
    expect(retried.patch.after.palette).toHaveLength(18);
  });

  it("rejects duplicate IDs and sources without allocating colors, and skips unused/noop mappings", () => {
    const document = createPixelDocument({ width: 2, height: 1, palette: colors, pixels: [1, 2] });
    const result = createRemapColorsPatch(document, { ...target, mappings: [
      { id: "a", fromColorIndex: 1, toColor: "#123456ff" }, { id: "b", fromColorIndex: 1, toColor: "#987654ff" },
      { id: "c", fromColorIndex: 2, toColor: colors[2] }, { id: "d", fromColorIndex: 3, toColor: "#876543ff" }
    ] }, "duplicates");
    expect(result.results.map((item) => item.status)).toEqual(["failed", "failed", "noop", "noop"]);
    expect(result.changedPixels).toBe(0);
    expect(result.patch.after.palette).toEqual(colors);
    const duplicateIds = createRemapColorsPatch(document, { ...target, mappings: [
      { id: "same", fromColorIndex: 1, toColor: colors[3] }, { id: "same", fromColorIndex: 2, toColor: colors[3] }
    ] }, "ids");
    expect(duplicateIds.results.map((item) => item.code)).toEqual(["DUPLICATE_ID", "DUPLICATE_ID"]);
  });

  it("fails a new color at palette capacity but still reuses an existing RGBA", () => {
    const palette = Array.from({ length: 256 }, (_, index) => `#${index.toString(16).padStart(2, "0")}0000ff`);
    palette[0] = "#00000000";
    const document = createPixelDocument({ width: 2, height: 1, palette, pixels: [1, 2] });
    const result = createRemapColorsPatch(document, { ...target, mappings: [
      { id: "full", fromColorIndex: 1, toColor: "#aabbccff" }, { id: "reuse", fromColorIndex: 2, toColor: palette[3] }
    ] }, "capacity");
    expect(result.results.map((item) => item.code ?? item.status)).toEqual(["PALETTE_FULL", "applied"]);
    expect(result.patch.after.palette).toHaveLength(256);
    expect(result.patch.after.layers[0]!.frames["frame-1"]).toEqual([1, 3]);
  });
});
