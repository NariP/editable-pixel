import { createPixelDocument } from "@editable-pixel/document";
import { createPixelProject } from "@editable-pixel/project";
import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";

describe("partial session transactions", () => {
  it("validates each child, skips failed dependencies, and records the successful subset once", async () => {
    const store = new SessionStore();
    const created = await store.create({ document: createPixelDocument({ width: 2, height: 1 }) });
    const id = created.session.id;
    const result = await store.executeBatch(id, { baseRevision: 0, reason: "batch", operations: [
      { id: "invalid", action: { type: "not_an_action" } },
      { id: "dependent", dependsOn: ["invalid"], action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 150 } },
      { id: "valid", action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 120 } },
      { id: "named", dependsOn: ["valid"], action: { type: "rename_frame", frameId: "frame-1", name: "Renamed" } }
    ] });
    expect(result.mutation.results.map((item) => item.status)).toEqual(["failed", "skipped", "applied", "applied"]);
    expect(result.document.frames[0]).toMatchObject({ name: "Renamed", durationMs: 120 });
    expect(result.revision).toBe(1);
    expect(store.getHistory(id).entries).toHaveLength(1);
    expect((await store.undo(id)).document.frames).toEqual(created.session.document.frames);
    expect((await store.redo(id)).document.frames).toEqual(result.document.frames);
  });

  it("does not create history for all failed, noop, or net-zero actions", async () => {
    const store = new SessionStore();
    const { session } = await store.create({ document: createPixelDocument({ width: 1, height: 1 }) });
    for (const operations of [
      [{ id: "bad", action: null }],
      [{ id: "noop", action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 100 } }],
      [{ id: "a", action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 120 } }, { id: "b", action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 100 } }]
    ]) {
      const result = await store.executeBatch(session.id, { baseRevision: 0, reason: "nothing", operations });
      expect(result.mutation.committed).toBe(false);
      expect(result.revision).toBe(0);
    }
    expect(store.getHistory(session.id).entries).toHaveLength(0);
  });

  it("rejects stale and concurrent bases before touching the winner", async () => {
    const store = new SessionStore();
    const { session } = await store.create({ document: createPixelDocument({ width: 1, height: 1 }) });
    const operation = (durationMs: number) => ({ baseRevision: 0, reason: "race", operations: [{ id: "duration", action: { type: "set_frame_duration", frameId: "frame-1", durationMs } }] });
    const results = await Promise.allSettled([store.executeBatch(session.id, operation(120)), store.executeBatch(session.id, operation(150))]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(store.get(session.id).document.frames[0]!.durationMs).toBe(120);
    await expect(store.executeBatch(session.id, operation(180))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(store.getHistory(session.id).entries).toHaveLength(1);
  });

  it("keeps invalid bounded child pixels out of the combined document patch", async () => {
    const store = new SessionStore();
    const document = createPixelDocument({ width: 3, height: 1 });
    document.selection = { type: "rect", layerId: "artwork", frameId: "frame-1", x: 0, y: 0, width: 1, height: 1 };
    const { session } = await store.create({ document });
    const result = await store.executeBatch(session.id, { baseRevision: 0, reason: "bounded", operations: [
      { id: "outside", action: { type: "paint_pixels", pixels: [{ x: 2, y: 0, colorIndex: 1 }] } },
      { id: "inside", action: { type: "paint_selection", colorIndex: 1 } }
    ] });
    expect(result.mutation.results.map((item) => item.status)).toEqual(["failed", "applied"]);
    expect(result.document.layers[0]!.frames["frame-1"]).toEqual([1, 0, 0]);
  });

  it("combines project and document actions into one reversible project revision", async () => {
    const store = new SessionStore();
    const { session } = await store.create({ project: createPixelProject() });
    const result = await store.executeBatch(session.id, { baseRevision: 0, reason: "project batch", operations: [
      { id: "name", action: { type: "rename_project", name: "Batch project" } },
      { id: "duration", action: { type: "set_frame_duration", frameId: "frame-1", durationMs: 120 } }
    ] });
    expect(result.project).toMatchObject({ name: "Batch project", revision: 1 });
    expect(store.getHistory(session.id).entries).toHaveLength(1);
    expect((await store.undo(session.id)).project?.name).toBe(session.project?.name);
  });
});
