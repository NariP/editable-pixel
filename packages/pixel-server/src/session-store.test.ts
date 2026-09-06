import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setPixel } from "@editable-pixel/core";
import { createPixelDocument, serializePixelDocument } from "@editable-pixel/document";
import { createPixelProject, parsePixelProject, serializePixelProject } from "@editable-pixel/project";
import { afterEach, describe, expect, it } from "vitest";

import { SessionStore, createSessionId } from "./session-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SessionStore", () => {
  it("isolates documents and consumes bootstrap tokens", async () => {
    const store = new SessionStore();
    const first = await store.create({ document: createPixelDocument({ width: 2, height: 2 }) });
    const second = await store.create({ document: createPixelDocument({ width: 3, height: 3 }) });

    expect(first.session.id).not.toBe(second.session.id);
    expect(store.get(first.session.id).document.canvas.width).toBe(2);
    expect(store.authenticate(first.session.id, first.bootstrapToken, true).persistentToken).toBe(first.persistentToken);
    expect(() => store.authenticate(first.session.id, first.bootstrapToken, true)).toThrow("invalid or expired");
  });

  it("previews without mutation and persists only after apply", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editable-pixel-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "character.pixel.json");
    const document = createPixelDocument({ width: 2, height: 2 });
    await writeFile(path, serializePixelDocument(document));
    const store = new SessionStore();
    const created = await store.create({ documentPath: path });
    const patch = setPixel(created.session.document, "artwork", "frame-1", 0, 0, 1);

    store.previewPatch(created.session.id, patch);
    expect(store.get(created.session.id).revision).toBe(0);
    const applied = await store.applyPatch(created.session.id, patch.id);

    expect(applied.revision).toBe(1);
    expect(JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")).revision).toBe(1);
  });

  it("rejects symlink document paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editable-pixel-test-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "target.pixel.json");
    const link = join(directory, "link.pixel.json");
    await writeFile(target, serializePixelDocument(createPixelDocument({ width: 1, height: 1 })));
    await symlink(target, link);

    await expect(new SessionStore().create({ documentPath: link })).rejects.toThrow("non-symlink");
  });

  it("rejects traversal output names and invalid patch palette indices", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 2, height: 2 }) });

    expect(() => store.outputPath(created.session.id, "../outside.png")).toThrow("must not contain a path");
    expect(() => store.createPatch(created.session.id, {
      reason: "invalid color",
      requireSelection: false,
      changes: [{ x: 0, y: 0, colorIndex: 999 }]
    })).toThrow("Palette");
  });

  it("rejects apply after the source file changes outside the session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editable-pixel-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "conflict.pixel.json");
    const document = createPixelDocument({ width: 2, height: 2 });
    await writeFile(path, serializePixelDocument(document));
    const store = new SessionStore();
    const created = await store.create({ documentPath: path });
    const patch = setPixel(created.session.document, "artwork", "frame-1", 0, 0, 1);
    store.previewPatch(created.session.id, patch);

    await writeFile(path, `${await readFile(path, "utf8")}\n`);

    await expect(store.applyPatch(created.session.id, patch.id)).rejects.toMatchObject({ code: "FILE_CONFLICT" });
  });

  it("discards the session and both tokens on close", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 1, height: 1 }) });

    store.close(created.session.id);

    expect(() => store.authenticate(created.session.id, created.persistentToken)).toThrow("not found");
    expect(() => store.authenticate(created.session.id, created.bootstrapToken)).toThrow("not found");
  });

  it("rejects a pending bounded patch after the browser selection changes", async () => {
    const store = new SessionStore();
    const document = createPixelDocument({ width: 3, height: 3 });
    document.selection = {
      type: "rect", x: 0, y: 0, width: 1, height: 1, layerId: "artwork", frameId: "frame-1"
    };
    const created = await store.create({ document, host: "codex" });
    const patch = store.createPatch(created.session.id, {
      reason: "selected pixel",
      changes: [{ x: 0, y: 0, colorIndex: 1 }]
    });
    store.previewPatch(created.session.id, patch);
    store.setSelection(created.session.id, {
      type: "rect", x: 2, y: 2, width: 1, height: 1, layerId: "artwork", frameId: "frame-1"
    });

    await expect(store.applyPatch(created.session.id, patch.id)).rejects.toMatchObject({
      code: "SELECTION_CONFLICT"
    });
    expect(store.get(created.session.id)).toMatchObject({ host: "codex", revision: 1 });
  });

  it("previews and applies an agent palette addition without touching pixels outside selection", async () => {
    const store = new SessionStore();
    const document = createPixelDocument({ width: 3, height: 3 });
    document.selection = {
      type: "rect", x: 1, y: 1, width: 1, height: 1, layerId: "artwork", frameId: "frame-1"
    };
    const created = await store.create({ document, host: "codex" });
    const newIndex = document.palette.length;
    const patch = store.createPatch(created.session.id, {
      reason: "Add a new selected accent",
      newColors: ["#7c3aedff"],
      changes: [{ x: 1, y: 1, colorIndex: newIndex }]
    });
    const preview = store.previewPatch(created.session.id, patch);

    expect(preview.patch.kind).toBe("palette-pixels");
    expect(preview.after.palette[newIndex]).toBe("#7c3aedff");
    expect(preview.after.layers[0]!.frames["frame-1"]!.filter((pixel) => pixel !== 0)).toHaveLength(1);
    const applied = await store.applyPatch(created.session.id, patch.id);
    expect(applied.document.layers[0]!.frames["frame-1"]![4]).toBe(newIndex);
  });

  it("reports recent agent clients without mixing them with browser connections", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 1, height: 1 }) });

    store.addClient(created.session.id, "web-test");
    store.touchClient(created.session.id, "mcp");

    expect(store.get(created.session.id).clients).toEqual(["web-test", "mcp"]);
    store.removeClient(created.session.id, "web-test");
    expect(store.get(created.session.id).clients).toEqual(["mcp"]);
  });

  it("records selection changes in undo and redo history", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 4, height: 4 }) });
    const selection = {
      type: "rect" as const,
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      layerId: "artwork",
      frameId: "frame-1"
    };

    expect(store.setSelection(created.session.id, selection).selection).toEqual(selection);
    const unchanged = store.setSelection(created.session.id, selection);
    expect(unchanged.revision).toBe(1);
    expect(store.getHistory(created.session.id).entries).toHaveLength(1);
    expect((await store.undo(created.session.id)).selection).toBeUndefined();
    expect((await store.redo(created.session.id)).selection).toEqual(selection);
  });

  it("opens a Project with active context, exposes bounded pixels, and persists agent edits to the Project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editable-pixel-project-session-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "robot.pixel-project.json");
    const project = createPixelProject({ id: "project-robot", name: "Robot" });
    project.document.selection = {
      type: "rect", x: 0, y: 0, width: 1, height: 1, layerId: "artwork", frameId: "frame-1"
    };
    await writeFile(path, serializePixelProject(project));
    const store = new SessionStore();
    const created = await store.create({ projectPath: path, host: "codex" });

    expect(created.session.projectContext).toMatchObject({
      projectId: "project-robot",
      clipId: project.clips[0]!.id,
      frameId: "frame-1",
      layerId: "artwork"
    });
    expect(store.getSelectionContext(created.session.id, 0)).toMatchObject({
      revision: 0,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      colorIndices: [[0]]
    });

    const patch = store.createPatch(created.session.id, {
      reason: "Agent accent",
      changes: [{ x: 0, y: 0, colorIndex: 1 }]
    });
    await store.applyPatch(created.session.id, patch);
    const persisted = parsePixelProject(await readFile(path, "utf8"));
    expect(persisted.revision).toBe(1);
    expect(persisted.document.layers[0]!.frames["frame-1"]![0]).toBe(1);
    expect(store.get(created.session.id).projectContext?.projectRevision).toBe(1);
  });

  it("shares AI selection and edits with the canonical history and design context", async () => {
    const store = new SessionStore();
    const document = createPixelDocument({ width: 4, height: 4 });
    const created = await store.create({ document });

    store.setSelectionCommand(created.session.id, {
      type: "rect",
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      mode: "replace"
    }, "ai", "mcp");
    await store.executeAction(created.session.id, {
      action: { type: "paint_selection", colorIndex: 1 },
      reason: "Paint AI selection",
      actor: "ai",
      client: "mcp"
    });

    expect(store.getDesignContext(created.session.id, { padding: 0 })).toMatchObject({
      bounds: { x: 1, y: 1, width: 2, height: 2 },
      colorIndices: [[1, 1], [1, 1]]
    });
    expect(store.getPaletteContext(created.session.id).colors[1]).toMatchObject({ usedPixels: 4 });
    expect(store.getHistory(created.session.id).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "ai", client: "mcp", reason: "Paint AI selection", state: "applied" })
    ]));
    await store.undo(created.session.id);
    expect(store.get(created.session.id).document.layers[0]!.frames["frame-1"]!.filter((pixel) => pixel === 1)).toHaveLength(0);
    await store.redo(created.session.id);
    expect(store.get(created.session.id).document.layers[0]!.frames["frame-1"]!.filter((pixel) => pixel === 1)).toHaveLength(4);
  });

  it("creates immediate AI actions from the latest Project revision after an in-flight selection update", async () => {
    const store = new SessionStore();
    const project = createPixelProject({ id: "project-concurrent-selection", name: "Concurrent selection" });
    const created = await store.create({ project, host: "codex" });

    const action = store.executeAction(created.session.id, {
      action: { type: "add_layer", name: "AI Highlights" },
      reason: "Add highlights after selecting the target"
    });
    store.setSelectionCommand(created.session.id, {
      type: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      mode: "replace"
    });

    await expect(action).resolves.toMatchObject({ revision: 2 });
    const snapshot = store.get(created.session.id);
    expect(snapshot.document.selection).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    expect(snapshot.document.layers.map((layer) => layer.name)).toContain("AI Highlights");
  });

  it("uses the active Project Layer and Frame for unqualified AI pixel actions", async () => {
    const store = new SessionStore();
    const project = createPixelProject({ id: "project-active-target", name: "Active target" });
    const created = await store.create({ project, host: "codex" });

    await store.executeAction(created.session.id, {
      action: { type: "add_frame", name: "Frame 2" },
      reason: "Add target frame"
    });
    await store.executeAction(created.session.id, {
      action: { type: "add_layer", name: "Highlights" },
      reason: "Add target layer"
    });
    const metadata = store.getMetadata(created.session.id);
    const frameId = metadata.document.frames.find((frame) => frame.id !== "frame-1")!.id;
    const layerId = metadata.document.layers.find((layer) => layer.id !== "artwork")!.id;
    const clip = metadata.project!.clips.find((candidate) => candidate.frameIds.includes(frameId))!;
    store.setProjectContext(created.session.id, {
      projectId: metadata.project!.id,
      projectName: metadata.project!.name,
      projectRevision: metadata.project!.revision,
      clipId: clip.id,
      clipName: clip.name,
      frameId,
      layerId,
      layerName: "Highlights"
    });

    await store.executeAction(created.session.id, {
      action: { type: "paint_pixels", pixels: [{ x: 2, y: 3, colorIndex: 1 }] },
      reason: "Paint active target"
    });
    const document = store.get(created.session.id).document;
    expect(document.layers.find((layer) => layer.id === layerId)!.frames[frameId]![3 * document.canvas.width + 2]).toBe(1);
    expect(document.layers.find((layer) => layer.id === "artwork")!.frames["frame-1"]![3 * document.canvas.width + 2]).toBe(0);
  });

  it("returns bounded input errors for invalid AI context and selection requests", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 4, height: 4 }) });

    expect(() => store.getDesignContext(created.session.id, {
      bounds: { x: 3, y: 3, width: 2, height: 2 }
    })).toThrow(expect.objectContaining({ code: "BOUNDS_INVALID" }));
    expect(() => store.setSelectionCommand(created.session.id, {
      type: "color",
      colorIndex: 99
    })).toThrow(expect.objectContaining({ code: "SELECTION_INVALID" }));
  });

  it("keeps Project Clip ownership valid across AI Frame and Clip actions", async () => {
    const store = new SessionStore();
    const project = createPixelProject({ id: "project-motion", name: "Motion" });
    const created = await store.create({ project, host: "codex" });

    await store.executeAction(created.session.id, {
      action: { type: "duplicate_frame", frameId: "frame-1" },
      reason: "Duplicate animation frame"
    });
    const metadataAfterFrame = store.getMetadata(created.session.id);
    const newFrameId = metadataAfterFrame.document.frames.find((frame) => frame.id !== "frame-1")!.id;
    expect(metadataAfterFrame.project?.clips[0]!.frameIds).toContain(newFrameId);

    await store.executeAction(created.session.id, {
      action: { type: "create_clip", name: "Second motion", frameIds: [newFrameId] },
      reason: "Split a second clip"
    });
    const motion = store.getMotionContext(created.session.id);
    expect(motion.clips.map((clip) => [clip.name, clip.frames.length])).toEqual([
      ["Clip 1", 1],
      ["Second motion", 1]
    ]);
    expect(store.getHistory(created.session.id).entries[0]).toMatchObject({
      actor: "ai",
      reason: "Split a second clip"
    });
  });
});

describe("session id shape", () => {
  // base64url includes `-` and `_`. A session id starting with `-` was read as an
  // option flag by the CLI's argument parser, so `--session <id>` failed for roughly
  // 1 in 64 sessions — twice observed in CI. These are deterministic where the bug was not:
  // a single session only reproduces it 1.6% of the time.
  it("never mints a session whose id an argument parser reads as a flag", async () => {
    // Drives the real create() path, not the generator directly, so that reverting the
    // call site to a plain token() fails here rather than passing on an unused helper.
    const store = new SessionStore();
    const ids: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      ids.push((await store.create({ document: createPixelDocument({ width: 1, height: 1 }) })).session.id);
    }
    const leadingFlag = ids.filter((id) => id.startsWith("-") || id.startsWith("_"));

    expect(leadingFlag, `${leadingFlag.length} of ${ids.length} minted ids would parse as flags`).toEqual([]);
  });

  it("never returns a flag-shaped id from the generator", () => {
    const ids = Array.from({ length: 10_000 }, () => createSessionId());

    expect(ids.filter((id) => id.startsWith("-") || id.startsWith("_"))).toEqual([]);
  });

  it("keeps the full base64url alphabet after the first character", () => {
    // Only the leading byte is constrained; narrowing the rest would cost real entropy.
    const tail = new Set(Array.from({ length: 10_000 }, () => createSessionId()).flatMap((id) => [...id.slice(1)]));

    expect(tail.has("-") || tail.has("_"), "later positions must keep the full alphabet").toBe(true);
  });

  it("keeps the id length stable", () => {
    const lengths = new Set(Array.from({ length: 200 }, () => createSessionId().length));

    expect(lengths.size, "redrawing the first byte must not change the length").toBe(1);
  });
});
