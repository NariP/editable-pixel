import { describe, expect, it } from "vitest";

import {
  createPixelDocument,
  migratePixelDocument,
  parsePixelDocument,
  serializePixelDocument,
  validatePixelDocument
} from "./index.js";

describe("Pixel Document", () => {
  it("round-trips a valid document without loss", () => {
    const document = createPixelDocument({
      width: 2,
      height: 2,
      palette: ["#00000000", "#ff004dff"],
      pixels: [0, 1, 1, 0]
    });

    expect(parsePixelDocument(serializePixelDocument(document))).toEqual(document);
  });

  it("creates deterministic identifiers and serialization", () => {
    const input = {
      width: 2,
      height: 2,
      palette: ["#00000000", "#ffffffff"],
      pixels: [0, 1, 1, 0]
    };

    const first = createPixelDocument(input);
    const second = createPixelDocument(input);

    expect(first.id).toBe(second.id);
    expect(serializePixelDocument(first, false)).toBe(serializePixelDocument(second, false));
  });

  it("keeps readable and compact serialization semantically identical", () => {
    const document = createPixelDocument({ width: 3, height: 2, pixels: [0, 1, 0, 1, 0, 1] });

    expect(parsePixelDocument(serializePixelDocument(document, true))).toEqual(
      parsePixelDocument(serializePixelDocument(document, false))
    );
  });

  it("rejects a pixel array whose length differs from the canvas", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    document.layers[0]!.frames["frame-1"] = [0, 0, 0];

    const result = validatePixelDocument(document);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("Expected 4 pixels"))).toBe(true);
  });

  it("rejects palette indices outside the palette", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    document.layers[0]!.frames["frame-1"] = [9];

    const result = validatePixelDocument(document);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("reference the palette"))).toBe(true);
  });

  it("rejects duplicate frame and layer identifiers", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    document.frames.push({ ...document.frames[0]! });
    document.layers.push({ ...document.layers[0]! });

    const result = validatePixelDocument(document);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toContain("Frame IDs must be unique.");
    expect(result.issues.map((issue) => issue.message)).toContain("Layer IDs must be unique.");
  });

  it("rejects duplicate named-region identifiers", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    const region = {
      id: "face",
      name: "Face",
      layerId: "artwork",
      frameId: "frame-1",
      bounds: { x: 0, y: 0, width: 1, height: 1 }
    };
    document.regions.push(region, { ...region, name: "Other" });

    expect(validatePixelDocument(document).issues).toContainEqual({
      path: "/regions",
      message: "Region IDs must be unique."
    });
  });

  it("accepts a referenced rectangular selection", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    document.selection = {
      type: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layerId: "artwork",
      frameId: "frame-1"
    };

    expect(validatePixelDocument(document)).toEqual({ valid: true, issues: [] });
  });

  it("accepts a sparse mask selection and rejects indices outside its bounds", () => {
    const document = createPixelDocument({ width: 3, height: 3 });
    document.selection = {
      type: "mask",
      x: 0,
      y: 0,
      width: 3,
      height: 3,
      layerId: "artwork",
      frameId: "frame-1",
      indices: [0, 4, 8]
    };

    expect(validatePixelDocument(document)).toEqual({ valid: true, issues: [] });
    document.selection.indices = [0, 4, 9];
    expect(validatePixelDocument(document).issues).toContainEqual({
      path: "/selection/indices",
      message: "Mask selection indices must be inside its bounds and canvas."
    });
    document.selection.indices = [4, 0];
    expect(validatePixelDocument(document).issues).toContainEqual({
      path: "/selection/indices",
      message: "Mask selection indices must be unique and strictly ascending."
    });
  });

  it("migrates the legacy flat v0 document", () => {
    const migrated = migratePixelDocument({
      format: "pixel-document",
      version: 0,
      width: 2,
      height: 1,
      palette: ["#00000000", "#ffffffff"],
      pixels: [0, 1]
    });

    const parsed = parsePixelDocument(migrated);

    expect(parsed.version).toBe(1);
    expect(parsed.canvas).toEqual({ width: 2, height: 1 });
    expect(parsed.layers[0]!.frames["frame-1"]).toEqual([0, 1]);
  });

  it("rejects an unsupported future document version", () => {
    const future = { ...createPixelDocument({ width: 1, height: 1 }), version: 2 };

    expect(() => parsePixelDocument(future)).toThrow("/version");
  });
});
