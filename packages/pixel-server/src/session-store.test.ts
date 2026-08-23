import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setPixel } from "@editable-pixel/core";
import { createPixelDocument, serializePixelDocument } from "@editable-pixel/document";
import { afterEach, describe, expect, it } from "vitest";

import { SessionStore } from "./session-store.js";

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
    expect((await store.undo(created.session.id)).selection).toBeUndefined();
    expect((await store.redo(created.session.id)).selection).toEqual(selection);
  });
});
