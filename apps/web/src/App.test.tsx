import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createPixelDocument } from "@editable-pixel/document";
import { createPixelProject, serializePixelProject } from "@editable-pixel/project";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { App, mergeFrameDocuments, resolveCanvasOnionSkin } from "./App.js";

beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  class TestImageData {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number
    ) {}
  }
  vi.stubGlobal("ImageData", TestImageData);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 320, width: 320, height: 320,
    toJSON: () => ({})
  }));
  HTMLElement.prototype.setPointerCapture = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:editable-pixel-test");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function addBlankFrame() {
  fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
  fireEvent.click(screen.getByRole("button", { name: /Blank frame/ }));
}

describe("Editable Pixel web editor", () => {
  it("hides onion skin overlays during playback without changing the editor settings", () => {
    const settings = { previous: 1, next: 1, opacity: 0.3 };

    expect(resolveCanvasOnionSkin(settings, ["frame-1", "frame-2"], true)).toEqual({
      previous: 0,
      next: 0,
      opacity: 0.3,
      frameIds: ["frame-1", "frame-2"]
    });
    expect(resolveCanvasOnionSkin(settings, ["frame-1", "frame-2"], false)).toEqual({
      ...settings,
      frameIds: ["frame-1", "frame-2"]
    });
    expect(settings).toEqual({ previous: 1, next: 1, opacity: 0.3 });
  });

  it("combines converted images into one document with ordered frames", () => {
    const first = createPixelDocument({ width: 2, height: 1, palette: ["#00000000", "#ff0000ff"], pixels: [1, 0] });
    const second = createPixelDocument({ width: 2, height: 1, palette: ["#00000000", "#ff0000ff"], pixels: [0, 1] });

    const sequence = mergeFrameDocuments([first, second], ["source-a", "source-b"]);

    expect(sequence.frames.map((frame) => frame.id)).toEqual(["source-a", "source-b"]);
    expect(sequence.frames[0]!.lighting).toEqual(first.frames[0]!.lighting);
    expect(sequence.frames[1]!.lighting).toBeUndefined();
    expect(sequence.layers[0]!.frames["source-a"]).toEqual([1, 0]);
    expect(sequence.layers[0]!.frames["source-b"]).toEqual([0, 1]);
  });

  it("keeps frame timing when conversion settings rebuild an animation", () => {
    const first = createPixelDocument({ width: 2, height: 1, palette: ["#00000000", "#ff0000ff"], pixels: [1, 0] });
    const second = createPixelDocument({ width: 2, height: 1, palette: ["#00000000", "#ff0000ff"], pixels: [0, 1] });

    const sequence = mergeFrameDocuments(
      [first, second],
      ["source-a", "source-b"],
      [
        { id: "source-a", name: "Frame 1", durationMs: 180 },
        { id: "source-b", name: "Frame 2", durationMs: 80 }
      ]
    );

    expect(sequence.frames.map((frame) => frame.durationMs)).toEqual([180, 80]);
  });

  it("keeps lighting keyframes when conversion settings rebuild an animation", () => {
    const first = createPixelDocument({ width: 2, height: 1 });
    const second = createPixelDocument({ width: 2, height: 1 });
    const lighting = { ...first.frames[0]!.lighting!, x: 0.8 };

    const sequence = mergeFrameDocuments(
      [first, second],
      ["source-a", "source-b"],
      [
        { id: "source-a", name: "Frame 1", durationMs: 180, lighting, lightingInterpolation: "linear" },
        { id: "source-b", name: "Frame 2", durationMs: 80 }
      ]
    );

    expect(sequence.frames[0]).toMatchObject({ lighting, lightingInterpolation: "linear" });
    expect(sequence.frames[1]!.lighting).toBeUndefined();
  });

  it("renders the canvas-first conversion, editing, session, and export workspace", () => {
    render(<App />);

    expect(screen.getByRole("img", { name: "Editable Pixel" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toBe("Untitled Project");
    expect(screen.queryByText("EDITABLE PIXEL")).toBeNull();
    expect(screen.getByRole("tab", { name: "Convert" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Frames" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Agent" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Content Frame" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Line" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Import$/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "IMPORT AI IMAGE" })).toBeNull();
    expect(screen.queryByRole("button", { name: "DROP / PASTE IMAGE" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare original" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save As" })).toBeNull();
    expect(screen.getByRole("button", { name: /Sources/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "Sources" })).toBeNull();
    expect(screen.queryByText("AI SOURCE")).toBeNull();
    expect(screen.queryByText(/reconversion creates a new variant/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Session details" }).textContent).toContain("Standalone");
  });

  it("keeps project sources and Save As outside the Convert, Edit, and Frames tabs", () => {
    render(<App />);

    const scopeToggle = screen.getByRole("button", { name: /Sources/ });
    expect(scopeToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(scopeToggle);
    expect(scopeToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Retained originals" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    expect(screen.getByRole("button", { name: "Save As" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Retained originals" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Convert" }));
    expect(screen.getByRole("heading", { name: "Retained originals" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    expect(screen.getByRole("heading", { name: "Retained originals" })).toBeTruthy();
  });

  it("keeps one canvas per project and exposes retained sources without asset controls", () => {
    render(<App />);

    expect(screen.queryByLabelText(/assets?$/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add blank asset" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Asset name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    expect(screen.getByRole("heading", { name: "Retained originals" })).toBeTruthy();
    expect(screen.getByText("No source attached")).toBeTruthy();
  });

  it("uses Save As to create and switch to an independently named project", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    const name = screen.getByRole("textbox", { name: "Save As project name" });
    fireEvent.change(name, { target: { value: "Robot Collection" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toContain("Robot Collection"));
  });

  it("renames the current project directly from the project menu", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    const name = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(name, { target: { value: "Robot Animation" } });
    fireEvent.blur(name);

    await waitFor(() => expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toContain("Robot Animation"));
  });

  it("creates a source-less project and opens a complete Project file from the project menu", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByRole("textbox", { name: "New project name" })).toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save As" })).toBeNull());
    expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toContain("Untitled Project");
    expect(screen.getByRole("button", { name: /Sources/ }).textContent).toContain("No retained source");

    const imported = createPixelProject({ id: "project-opened", name: "Opened Robot Project", width: 8, height: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    fireEvent.change(screen.getByLabelText("Open Project file input"), {
      target: { files: [new File([serializePixelProject(imported)], "robot.pixel-project.json", { type: "application/json" })] }
    });

    await waitFor(() => expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toContain("Opened Robot Project"));
    fireEvent.click(screen.getByRole("button", { name: "Project menu" }));
    expect(screen.getByRole("button", { name: "Save As" })).toBeTruthy();
  });

  it("offers animation import for multiple images and lets the user reorder frames", () => {
    render(<App />);
    const later = new File(["later"], "walk_10.png", { type: "image/png", lastModified: 10 });
    const earlier = new File(["earlier"], "walk_2.png", { type: "image/png", lastModified: 2 });

    fireEvent.change(screen.getByLabelText("Import files"), {
      target: { files: [later, earlier] }
    });

    expect(screen.getByRole("dialog", { name: "Choose an import purpose" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Frame order" });
    expect(list.children[0]?.textContent).toContain("walk_2.png");
    expect(list.children[1]?.textContent).toContain("walk_10.png");
    expect(screen.getByRole("button", { name: /Replace Canvas/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add as Frames/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import Sprite Sheet/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Add Source/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Replace Source/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Move walk_10.png earlier" }));
    expect(list.children[0]?.textContent).toContain("walk_10.png");
    expect(list.children[1]?.textContent).toContain("walk_2.png");
  });

  it("adds and explicitly replaces retained sources without creating variants", async () => {
    render(<App />);
    const first = new File(["first"], "robot.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Import files"), { target: { files: [first] } });
    fireEvent.click(screen.getByRole("button", { name: /Add Source/ }));

    await waitFor(() => expect(screen.getByLabelText("1 source")).toBeTruthy());
    expect(screen.getByText("robot.png", { selector: ".source-name b" })).toBeTruthy();
    expect(screen.queryByText(/\bV1\b|\bV2\b/)).toBeNull();

    const second = new File(["second"], "robot-updated.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Import files"), { target: { files: [second] } });
    expect(screen.getByRole("button", { name: /Replace Source/ }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Replace Source/ }));

    await waitFor(() => expect(screen.getByText("robot-updated.png", { selector: ".source-name b" })).toBeTruthy());
    expect(screen.getByLabelText("1 source")).toBeTruthy();
    expect(screen.queryByText("robot.png", { selector: ".source-name b" })).toBeNull();
  });

  it("uses a sortable layer row with header add and right-side visibility actions", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Add layer" })).toBeTruthy();
    expect(screen.getByText("Artwork", { selector: ".toolbar-layer" })).toBeTruthy();
    expect(document.querySelector(".canvas-toolbar")?.textContent?.startsWith("Frame 1/Artwork")).toBe(true);
    expect(screen.getByRole("button", { name: "Reorder Artwork" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Hide Artwork" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Layers" }).closest(".inspector-section")?.querySelector(".compact-actions")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Frames" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete layer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add layer" }));
    expect(screen.getByRole("button", { name: "Reorder Layer 2" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Hide Layer 2" })).toBeTruthy();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Select Layer 2 layer" }));
    const nameInput = screen.getByRole("textbox", { name: "Rename Layer 2" });
    fireEvent.change(nameInput, { target: { value: "Highlights" } });
    fireEvent.blur(nameInput);
    expect(screen.getByRole("button", { name: "Select Highlights layer" })).toBeTruthy();
    expect(screen.getByText("Highlights", { selector: ".toolbar-layer" })).toBeTruthy();
  });

  it("uses a sortable frame list with header playback and inline metadata", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));

    expect(screen.getByRole("heading", { name: "Frames" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize clips and frames" })).toBeTruthy();
    expect(screen.getByLabelText("1 frame")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add frame" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
    expect(screen.getByRole("button", { name: /Blank frame/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /From images/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
    expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Reorder Frame 1" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Frame 1" })).toBeNull();

    addBlankFrame();
    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(2);
    expect(screen.getByLabelText("2 frames")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Reorder Frame 2" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Select Frame 2 frame" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Select Frame 2 frame" }).closest(".frame-stack-item")?.className).toContain("active keyboard-target");

    expect(screen.queryByRole("textbox", { name: /Rename Frame/ })).toBeNull();
    const duration = screen.getByRole("textbox", { name: "Frame 2 duration" });
    fireEvent.change(duration, { target: { value: "250" } });
    fireEvent.blur(duration);
    expect(screen.getByRole("textbox", { name: "Frame 2 duration" }).getAttribute("value")).toBe("250");

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Select Frame 1 frame" }).closest(".frame-stack-item")?.className).toContain("active keyboard-target");

    fireEvent.keyDown(window, { key: "Delete" });
    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(1);
    expect(screen.getByText("A document must keep at least one frame.")).toBeTruthy();
  });

  it("duplicates the active frame when frames own copy and paste shortcuts", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    addBlankFrame();

    const duration = screen.getByRole("textbox", { name: "Frame 2 duration" });
    fireEvent.change(duration, { target: { value: "250" } });
    fireEvent.blur(duration);
    fireEvent.keyDown(window, { key: "c", metaKey: true });
    fireEvent.keyDown(window, { key: "v", metaKey: true });

    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(3);
    expect(screen.getByLabelText("3 frames")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Frame 2 duration" }).getAttribute("value")).toBe("250");
    expect(screen.getByRole("textbox", { name: "Frame 3 duration" }).getAttribute("value")).toBe("250");
    expect(screen.getByRole("button", { name: "Select Frame 3 frame" }).closest(".frame-stack-item")?.className).toContain("active keyboard-target");
  });

  it("creates independent clips and keeps frame actions inside the active clip", async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));

    expect(screen.getByLabelText("1 clip")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add clip" }));
    expect(screen.getByLabelText("2 clips")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Clip 2 clip" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toBe("Untitled Project/Clip 2");
    expect(screen.queryByRole("button", { name: "Rename clip" })).toBeNull();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Select Clip 2 clip" }));
    const clipNameInput = screen.getByRole("textbox", { name: "Clip name" }) as HTMLInputElement;
    expect(clipNameInput.value).toBe("Clip 2");
    expect(clipNameInput.closest(".clip-item")?.textContent).toContain("1 frame");
    expect(within(clipNameInput.closest(".clip-item") as HTMLElement).getByRole("button", { name: "Delete clip" })).toBeTruthy();
    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(1);

    fireEvent.change(clipNameInput, { target: { value: "Jump" } });
    fireEvent.blur(clipNameInput);
    expect(screen.getByRole("navigation", { name: "Project location" }).textContent).toContain("Jump");

    addBlankFrame();
    expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(2);
    expect(screen.getByLabelText("2 frames")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select Clip 1 clip" }));
    await waitFor(() => expect(container.querySelectorAll(".frame-stack-item")).toHaveLength(1));
    expect(screen.getByLabelText("1 frame")).toBeTruthy();
  });

  it("routes clipboard and delete shortcuts to the visible keyboard target", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add layer" }));

    const shell = container.querySelector(".pixel-canvas-shell") as HTMLElement;
    expect(shell.className).toContain("keyboard-target");

    const layer2Button = screen.getByRole("button", { name: "Select Layer 2 layer" });
    const artworkButton = screen.getByRole("button", { name: "Select Artwork layer" });
    fireEvent.pointerDown(layer2Button);
    expect(shell.className).not.toContain("keyboard-target");
    expect(layer2Button.closest(".stack-item")?.className).toContain("active keyboard-target");
    expect(artworkButton.closest(".stack-item")?.className).not.toContain("keyboard-target");
    fireEvent.click(layer2Button);

    fireEvent.keyDown(window, { key: "c", metaKey: true });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: "Select Layer 2 layer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select Artwork layer" }).closest(".stack-item")?.className).toContain("active keyboard-target");
    fireEvent.keyDown(window, { key: "v", metaKey: true });
    expect(screen.getByRole("button", { name: "Select Layer 2 copy layer" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: "Select Layer 2 copy layer" })).toBeNull();
    expect(container.querySelectorAll(".stack-item")).toHaveLength(1);

    fireEvent.pointerDown(shell, { clientX: 16, clientY: 16, pointerId: 1 });
    fireEvent.pointerCancel(shell, { pointerId: 1 });
    expect(shell.className).toContain("keyboard-target");
    expect(container.querySelector(".stack-item.keyboard-target")).toBeNull();

    fireEvent.keyDown(window, { key: "Backspace" });
    expect(container.querySelectorAll(".stack-item")).toHaveLength(1);
  });

  it("keeps agent guidance inside the floating session popover", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Session details" }));

    expect(await screen.findByRole("heading", { name: "Agent workflow" })).toBeTruthy();
    expect(screen.getByText("Validated agent actions apply immediately", { exact: false })).toBeTruthy();
    expect(screen.getByText("AI and browser edits share the same History", { exact: false })).toBeTruthy();
  });

  it("offers scaled Frame, Clip, and Project exports from one header popover", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const png = await screen.findByRole("button", { name: "PNG" });
    expect(png.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Normal map" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lit PNG" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GIF" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Export scope" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Current Frame" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Current Clip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entire Project" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "PNG scale" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "8×" }));
    expect(document.querySelector(".export-size")?.textContent).toBe("32 × 32→256 × 256");

    fireEvent.click(screen.getByRole("button", { name: "GIF" }));
    expect(screen.getByRole("button", { name: "Current Frame" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Current Clip" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Export Current Clip GIF" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    expect(screen.queryByRole("group", { name: "PNG scale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Current Frame" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Current Clip" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Export Project" })).toBeTruthy();
  });

  it("edits normal maps with a direction picker and live light controls", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Material Maps" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));
    expect(screen.getByRole("slider", { name: "Normal direction" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lit preview" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Lighting shading" }).textContent).toContain("Toon palette");
    expect(screen.getByRole("combobox", { name: "Toon palette ramp steps" }).textContent).toContain("4 steps");
    expect(screen.getByRole("button", { name: "About Palette ramp" })).toBeTruthy();
    expect(screen.queryByText(/Normal directions then choose/)).toBeNull();
    expect(screen.getByRole("slider", { name: "Light strength" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Ambient light" })).toBeTruthy();
    const animate = screen.getByRole("switch", { name: "Animate lighting" });
    expect(animate.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("group", { name: "Lighting timeline" })).toBeNull();
    fireEvent.click(animate);
    expect(animate.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("group", { name: "Lighting timeline" })).toBeTruthy();
    const transition = screen.getByRole("combobox", { name: "Lighting transition" });
    expect(transition.textContent).toContain("Ease in-out");
    fireEvent.click(transition);
    fireEvent.click(screen.getByRole("option", { name: "Ease in" }));
    expect(transition.textContent).toContain("Ease in");
    expect(screen.getByRole("button", { name: "Move light" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide light marker" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide light marker" }));
    expect(screen.queryByRole("button", { name: "Move light" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show light marker" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Show light marker" }));
    expect(screen.getByRole("button", { name: "Move light" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset normal map" })).toBeTruthy();
    expect(document.querySelector(".toolbar-map")?.textContent).toBe("Normal · Lit");

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.queryByRole("button", { name: "Move light" })).toBeNull();
  });

  it("creates lighting keyframes from a compact frame timeline", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    addBlankFrame();
    addBlankFrame();
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));

    fireEvent.click(screen.getByRole("switch", { name: "Animate lighting" }));
    expect(screen.getAllByRole("button", { name: /Remove Frame .* lighting keyframe/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Select Frame 2 in lighting timeline" }));
    expect(screen.getByRole("button", { name: "Add Frame 2 lighting keyframe" })).toBeTruthy();
    expect(screen.getByText("Frame 2 is interpolated")).toBeTruthy();

    const strength = screen.getByRole("slider", { name: "Light strength" });
    fireEvent.change(strength, { target: { value: "1.2" } });
    fireEvent.pointerUp(strength);
    expect(screen.getByRole("button", { name: "Remove Frame 2 lighting keyframe" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Remove Frame .* lighting keyframe/ })).toHaveLength(3);
  });

  it("moves the normal preview light by dragging on the canvas", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Normal" }));

    const shell = document.querySelector(".pixel-canvas-shell") as HTMLDivElement;
    shell.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({})
    });
    const light = screen.getByRole("button", { name: "Move light" });
    fireEvent.pointerDown(light, { clientX: 20, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(light, { clientX: 80, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(light, { pointerId: 1 });

    expect(light.style.left).toBe("80%");
    expect(light.style.top).toBe("70%");
  });

  it("offers normal-map PNG and sprite-sheet exports", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("button", { name: "Normal map" }));

    expect(screen.getByRole("button", { name: "Export Current Frame Normal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Current Clip" }));
    expect(screen.getByRole("button", { name: "Export Current Clip Normal" })).toBeTruthy();
  });

  it("offers a Lit PNG export with the current preview light", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lit PNG" }));

    expect(screen.getByRole("button", { name: "Export Current Frame Lit" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "PNG scale" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Current Clip" }));
    expect(screen.getByRole("button", { name: "Export Current Clip Lit" })).toBeTruthy();
  });

  it("defaults to Select and switches editing tools from the floating toolbar", () => {
    render(<App />);
    const select = screen.getByRole("button", { name: "Select" });
    expect(select.className).toContain("active");
    expect(select.getAttribute("data-icon-style")).toBe("solid");
    fireEvent.keyDown(window, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    expect(select.getAttribute("data-selection-mode")).toBe("toggle");
    fireEvent.keyUp(window, { key: "Shift", code: "ShiftLeft" });
    expect(select.getAttribute("data-selection-mode")).toBeNull();

    const pen = screen.getByRole("button", { name: "Pen" });
    fireEvent.click(pen);
    expect(pen.className).toContain("active");
    expect(pen.getAttribute("data-icon-style")).toBe("solid");
    expect(document.querySelector(".pixel-canvas-shell")?.className).toContain("tool-pen");
    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    expect(document.querySelector(".pixel-canvas-shell")?.className).toContain("tool-eraser");
    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    expect(document.querySelector(".pixel-canvas-shell")?.className).toContain("tool-fill");
    expect(select.className).not.toContain("active");
    expect(select.getAttribute("data-icon-style")).toBe("line");
  });

  it("shows the applied Content Frame as a non-export guide", () => {
    render(<App />);
    expect(screen.getByLabelText("Content frame 32 by 32")).toBeTruthy();
  });

  it("uses a selectable solid canvas background with a transparent thumbnail preview", async () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".pixel-canvas-shell") as HTMLElement;
    expect(shell.style.backgroundColor).toBe("rgb(216, 213, 204)");
    expect(container.querySelector(".canvas-background-thumbnail canvas")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Canvas background" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set canvas background to #171A17" }));

    expect(shell.style.backgroundColor).toBe("rgb(23, 26, 23)");
    expect(window.sessionStorage.getItem("editable-pixel:canvas-background")).toBe("#171a17");
  });

  it("defaults Content Frame alignment to the center", () => {
    render(<App />);
    expect(screen.getByRole("combobox", { name: "Content alignment" }).textContent).toContain("Center");
  });

  it("only offers background modes available in the web editor", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("combobox", { name: "Background mode" }));

    expect(screen.getByRole("option", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Solid" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Local remove" })).toBeNull();
  });

  it("explains Background and Dither from their labels", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "About Background" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "About Dither" })).toBeTruthy();
  });

  it("uses Tight and Safe as actions while editing a custom scale", () => {
    render(<App />);
    const safePreset = screen.getByRole("button", { name: /Safe 80%/ });
    const slider = screen.getByRole("slider", { name: "Content frame scale" });
    const customScale = screen.getByRole("textbox", { name: "Custom content frame scale" });

    expect(safePreset.className).not.toContain("active");
    fireEvent.change(slider, { target: { value: "0.65" } });
    expect(safePreset.className).not.toContain("active");
    expect((customScale as HTMLInputElement).value).toBe("65");

    fireEvent.change(customScale, { target: { value: "72" } });
    expect((slider as HTMLInputElement).value).toBe("0.65");
    fireEvent.blur(customScale);
    expect((slider as HTMLInputElement).value).toBe("0.72");
    expect(safePreset.className).not.toContain("active");

    fireEvent.click(screen.getByRole("button", { name: /Tight 100%/ }));
    expect((customScale as HTMLInputElement).value).toBe("100");
    fireEvent.click(safePreset);
    expect((customScale as HTMLInputElement).value).toBe("80");
  });

  it("edits the Fixed Palette with color inputs instead of raw text", () => {
    render(<App />);

    expect(screen.queryByRole("textbox", { name: "Fixed palette" })).toBeNull();
    expect(screen.getByRole("button", { name: "About Fixed Palette" })).toBeTruthy();
    expect(screen.queryByText(/Auto from source/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add fixed palette color" }));
    const colorText = screen.getByRole("textbox", { name: "Choose fixed palette color" });
    fireEvent.change(colorText, { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add color" }));

    const color = screen.getByLabelText("Fixed palette color 1") as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(color.value).toBe("#ff0000");

    fireEvent.click(screen.getByRole("button", { name: "Remove fixed palette color 1" }));
    expect(screen.queryByLabelText("Fixed palette color 1")).toBeNull();
    expect(screen.getByRole("button", { name: "About Fixed Palette" })).toBeTruthy();
  });

  it("keeps palette indices while moving color creation into the shared swatch grid", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    const transparent = screen.getByRole("button", { name: "Palette 0: #00000000" });
    expect(transparent.textContent).toBe("0");
    expect(screen.queryByRole("textbox", { name: "New palette color" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add palette color" }));
    expect(screen.getByRole("button", { name: "Pick color from canvas" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "New palette color" }), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Add color" }));

    expect(screen.getByRole("button", { name: "Palette 5: #123456ff" })).toBeTruthy();
    expect(screen.getByLabelText("Palette color 5 actions")).toBeTruthy();
  });

  it("enters an app-native canvas color picker from the palette input", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add palette color" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick color from canvas" }));

    expect(screen.getByText("Pick a color")).toBeTruthy();
    expect(container.querySelector(".pixel-canvas-shell")?.className).toContain("color-pick-cursor");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Pick a color")).toBeNull();
  });

  it("keeps replacement distinct from deleting an unused palette color", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: "Erase pixels" })).toBeNull();
    expect(screen.getByRole("button", { name: "Replace with" }).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Merge into" })).toBeNull();
    const deleteColor = screen.getByRole("button", { name: "Delete color" });
    expect(deleteColor.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("0 px used")).toBeTruthy();

    fireEvent.click(deleteColor);
    expect(screen.queryByRole("button", { name: "Palette 4: #b8ff3dff" })).toBeNull();
  });

  it("creates a real pixel-mask selection for every current-layer pixel using a palette color", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Palette 0: #00000000" }));

    fireEvent.click(screen.getByRole("button", { name: "Select pixels using color 0" }));
    expect(screen.getByLabelText("1024 selected pixels")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeTruthy();
    expect(screen.getByText(/Editing within selection · 1,024 pixels/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("1024 selected pixels")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Selection actions" })).toBeNull();
  });

  it("adds and removes individual pixels from the current selection with Shift-click", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".pixel-canvas-shell");
    if (!(shell instanceof HTMLElement)) throw new Error("Pixel canvas shell is not rendered.");

    fireEvent.pointerDown(shell, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(shell, { pointerId: 1 });
    expect(screen.getByText(/Editing within selection · 0,0 \/ 1×1/)).toBeTruthy();

    fireEvent.pointerDown(shell, { button: 0, pointerId: 2, clientX: 25, clientY: 5, shiftKey: true });
    expect(screen.getByLabelText("2 selected pixels")).toBeTruthy();
    fireEvent.pointerUp(shell, { pointerId: 2 });
    expect(screen.getByLabelText("2 selected pixels")).toBeTruthy();
    expect(screen.getByText(/Editing within selection · 2 pixels/)).toBeTruthy();

    fireEvent.pointerDown(shell, { button: 0, pointerId: 3, clientX: 5, clientY: 5, shiftKey: true });
    fireEvent.pointerUp(shell, { pointerId: 3 });
    expect(screen.queryByLabelText("2 selected pixels")).toBeNull();
    expect(screen.getByText(/Editing within selection · 2,0 \/ 1×1/)).toBeTruthy();
  });

  it("pastes one copied pixel into every pixel in a multi-selection as one edit", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    const shell = container.querySelector(".pixel-canvas-shell");
    if (!(shell instanceof HTMLElement)) throw new Error("Pixel canvas shell is not rendered.");

    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(shell, { pointerId: 1 });
    expect(screen.getByText("1 px used")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(shell, { pointerId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));

    fireEvent.pointerDown(shell, { button: 0, pointerId: 3, clientX: 25, clientY: 25 });
    fireEvent.pointerUp(shell, { pointerId: 3 });
    fireEvent.pointerDown(shell, { button: 0, pointerId: 4, clientX: 45, clientY: 25, shiftKey: true });
    fireEvent.pointerUp(shell, { pointerId: 4 });
    fireEvent.pointerDown(shell, { button: 0, pointerId: 5, clientX: 25, clientY: 45, shiftKey: true });
    fireEvent.pointerUp(shell, { pointerId: 5 });
    expect(screen.getByLabelText("3 selected pixels")).toBeTruthy();

    fireEvent.paste(window);
    expect(screen.getByText("4 px used")).toBeTruthy();
    expect(screen.getByLabelText("3 selected pixels")).toBeTruthy();

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByText("1 px used")).toBeTruthy();
    expect(screen.getByLabelText("3 selected pixels")).toBeTruthy();
  });

  it("pastes over occupied pixels in the selected destination frame", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".pixel-canvas-shell");
    if (!(shell instanceof HTMLElement)) throw new Error("Pixel canvas shell is not rendered.");

    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    addBlankFrame();

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Palette 2: #f4f0e6ff" }));
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 1, clientX: 45, clientY: 45 });
    fireEvent.pointerMove(shell, { pointerId: 1, clientX: 55, clientY: 45 });
    fireEvent.pointerUp(shell, { pointerId: 1 });
    expect(screen.getByText("2 px used")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Frame 1 frame" }));
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Palette 1: #171a17ff" }));
    fireEvent.click(screen.getByRole("button", { name: "Pen" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 2, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(shell, { pointerId: 2, clientX: 15, clientY: 5 });
    fireEvent.pointerUp(shell, { pointerId: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 3, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(shell, { pointerId: 3, clientX: 15, clientY: 5 });
    fireEvent.pointerUp(shell, { pointerId: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));

    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Frame 2 frame" }));
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.pointerDown(shell, { button: 0, pointerId: 4, clientX: 45, clientY: 45 });
    fireEvent.pointerMove(shell, { pointerId: 4, clientX: 55, clientY: 45 });
    fireEvent.pointerUp(shell, { pointerId: 4 });
    fireEvent.paste(window);

    fireEvent.click(screen.getByRole("button", { name: "Palette 1: #171a17ff" }));
    expect(screen.getByText("2 px used")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Palette 2: #f4f0e6ff" }));
    expect(screen.getByText("0 px used")).toBeTruthy();
  });

  it("keeps modifier-wheel zoom inside the editor", () => {
    const { container } = render(<App />);
    const viewport = container.querySelector(".canvas-viewport");
    if (!viewport) throw new Error("Canvas viewport is not rendered.");
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100
    });

    viewport.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
  });

  it("shows the editor shortcuts from the floating help button", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(await screen.findByRole("heading", { name: "Shortcuts" })).toBeTruthy();
    expect(screen.getByText("Zoom to area")).toBeTruthy();
    expect(screen.getByText("Pan canvas")).toBeTruthy();
    expect(screen.getByText("Add or remove pixels from selection")).toBeTruthy();
    expect(screen.getByText("Copy, cut, or paste selected pixels")).toBeTruthy();
    expect(screen.getByText("Copy or paste the active layer")).toBeTruthy();
  });

  it("fits the canvas with Shift+1 even when the shifted key is an exclamation mark", () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(container.querySelector(".zoom-control")?.textContent).toContain("200%");

    fireEvent.keyDown(window, { key: "!", shiftKey: true });

    expect(container.querySelector(".zoom-control")?.textContent).toContain("100%");
  });

  it("keeps onion skin switches across tabs without a duplicate canvas toolbar control", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Onion skin" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    const onionSettings = screen.getByRole("button", { name: "Onion skin settings" });
    expect(onionSettings.hasAttribute("disabled")).toBe(true);
    addBlankFrame();

    expect(onionSettings.hasAttribute("disabled")).toBe(false);
    fireEvent.click(onionSettings);
    expect(screen.getByRole("heading", { name: "Onion Skin" })).toBeTruthy();
    const previous = screen.getByRole("switch", { name: "Show previous frame" });
    const next = screen.getByRole("switch", { name: "Show next frame" });
    expect(previous.hasAttribute("disabled")).toBe(false);
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(previous.getAttribute("aria-checked")).toBe("true");
    expect(next.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("Onion skin opacity") as HTMLInputElement).value).toBe("0.3");

    fireEvent.click(previous);
    fireEvent.click(next);
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Onion skin" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Frames" }));
    expect(screen.getByRole("switch", { name: "Show previous frame" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Show next frame" }).getAttribute("aria-checked")).toBe("true");
  });
});
