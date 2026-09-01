import { createPixelDocument } from "@editable-pixel/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadLitPng } from "./export.js";

const putImageData = vi.fn();
const drawImage = vi.fn();

beforeEach(() => {
  class TestImageData {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number
    ) {}
  }
  vi.stubGlobal("ImageData", TestImageData);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    putImageData,
    drawImage,
    imageSmoothingEnabled: false
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob(["png"], { type: "image/png" })));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:lit-png"),
    revokeObjectURL: vi.fn()
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  putImageData.mockClear();
  drawImage.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Lit PNG export", () => {
  it("bakes the current light settings before downloading", async () => {
    const document = createPixelDocument({
      width: 1,
      height: 1,
      palette: ["#00000000", "#ff0000ff"],
      pixels: [1]
    });

    await downloadLitPng(document, {
      x: 0.5,
      y: 0.5,
      height: 1,
      intensity: 0,
      ambient: 0.25,
      shading: "smooth"
    });

    const imageData = putImageData.mock.calls[0]![0] as { data: Uint8ClampedArray };
    expect([...imageData.data]).toEqual([64, 0, 0, 255]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});
