import { describe, expect, it } from "vitest";

import {
  createPixelDocument,
  migratePixelDocument,
  parsePixelDocument,
  resolveFrameLighting,
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

  it("round-trips optional per-frame normal maps and validates their size", () => {
    const document = createPixelDocument({ width: 2, height: 1, pixels: [1, 0] });
    document.layers[0]!.normalFrames = { "frame-1": [0x8080ff, 0xff80b5] };

    expect(parsePixelDocument(serializePixelDocument(document))).toEqual(document);
    expect(validatePixelDocument(document)).toEqual({ valid: true, issues: [] });

    document.layers[0]!.normalFrames["frame-1"] = [0x8080ff];
    expect(validatePixelDocument(document).issues).toContainEqual({
      path: "/layers/0/normalFrames/frame-1",
      message: "Expected 2 normal pixels, received 1."
    });
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

  it("resolves Hold lighting from the previous keyframe", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    const start = { ...document.frames[0]!.lighting!, intensity: 0.2 };
    document.frames = [
      { id: "a", name: "Frame 1", durationMs: 100, lighting: start, lightingInterpolation: "hold" },
      { id: "b", name: "Frame 2", durationMs: 300 },
      { id: "c", name: "Frame 3", durationMs: 100, lighting: { ...start, intensity: 1 } }
    ];

    expect(resolveFrameLighting(document, ["a", "b", "c"], "b")).toEqual(start);
  });

  it("resolves Linear lighting from cumulative frame duration", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    const start = { x: 0, y: 0, height: 1, intensity: 0, ambient: 0 };
    const end = { x: 1, y: 1, height: 2, intensity: 1, ambient: 1 };
    document.frames = [
      { id: "a", name: "Frame 1", durationMs: 100, lighting: start, lightingInterpolation: "linear" },
      { id: "b", name: "Frame 2", durationMs: 300 },
      { id: "c", name: "Frame 3", durationMs: 100, lighting: end }
    ];

    expect(resolveFrameLighting(document, ["a", "b", "c"], "b")).toEqual({
      x: 0.25,
      y: 0.25,
      height: 1.25,
      intensity: 0.25,
      ambient: 0.25,
      shading: "toon-palette",
      toonSteps: 4
    });
    expect(resolveFrameLighting(document, ["b", "c"], "b")).toEqual({
      ...end,
      shading: "toon-palette",
      toonSteps: 4
    });
  });

  it.each([
    ["ease-in", 0.0625],
    ["ease-out", 0.4375],
    ["ease-in-out", 0.125]
  ] as const)("resolves %s lighting from eased frame progress", (interpolation, expected) => {
    const document = createPixelDocument({ width: 1, height: 1 });
    const start = { x: 0, y: 0, height: 1, intensity: 0, ambient: 0 };
    const end = { x: 1, y: 1, height: 2, intensity: 1, ambient: 1 };
    document.frames = [
      { id: "a", name: "Frame 1", durationMs: 100, lighting: start, lightingInterpolation: interpolation },
      { id: "b", name: "Frame 2", durationMs: 300 },
      { id: "c", name: "Frame 3", durationMs: 100, lighting: end }
    ];

    expect(resolveFrameLighting(document, ["a", "b", "c"], "b")).toEqual({
      x: expected,
      y: expected,
      height: 1 + expected,
      intensity: expected,
      ambient: expected,
      shading: "toon-palette",
      toonSteps: 4
    });
  });

  it("keeps discrete Toon palette settings from the previous lighting keyframe", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    document.frames = [
      { id: "a", name: "Frame 1", durationMs: 100, lighting: { ...document.frames[0]!.lighting!, shading: "toon-palette", toonSteps: 3 }, lightingInterpolation: "linear" },
      { id: "b", name: "Frame 2", durationMs: 100 },
      { id: "c", name: "Frame 3", durationMs: 100, lighting: { ...document.frames[0]!.lighting!, shading: "smooth", toonSteps: 6 } }
    ];

    expect(resolveFrameLighting(document, ["a", "b", "c"], "b")).toMatchObject({
      shading: "toon-palette",
      toonSteps: 3
    });
  });

  it("rejects interpolation metadata on a non-keyframe", () => {
    const document = createPixelDocument({ width: 1, height: 1 });
    delete document.frames[0]!.lighting;
    document.frames[0]!.lightingInterpolation = "linear";

    expect(validatePixelDocument(document).issues).toContainEqual({
      path: "/frames/0/lightingInterpolation",
      message: "Only a lighting keyframe can define interpolation."
    });
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
