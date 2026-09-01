import { DEFAULT_FRAME_LIGHTING, createPixelDocument } from "@editable-pixel/document";
import { describe, expect, it } from "vitest";

import {
  ProjectAutosaveQueue,
  ProjectUnavailableError,
  clonePixelProject,
  commitPixelProject,
  createPixelProject,
  parsePixelProject,
  serializePixelProject,
  validatePixelProject
} from "./index.js";

describe("Pixel Project", () => {
  it("round-trips a source-less project with a lit frame", () => {
    const project = createPixelProject({
      id: "project-test",
      name: "Robot",
      clipId: "clip-idle",
      width: 8,
      height: 8,
      now: "2026-08-23T00:00:00.000Z"
    });

    expect(project.sources).toEqual([]);
    expect(project.document.frames[0]!.lighting).toBeDefined();
    expect(parsePixelProject(serializePixelProject(project))).toEqual(project);
  });

  it("adds default lighting while wrapping an existing Pixel Document", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    delete document.frames[0]!.lighting;

    const project = createPixelProject({ document, id: "project-imported" });

    expect(project.document.frames[0]!.lighting).toEqual(DEFAULT_FRAME_LIGHTING);
  });

  it("accepts interpolated frames and requires one lighting keyframe per clip", () => {
    const document = createPixelDocument({ width: 2, height: 2 });
    document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 200 });
    document.layers[0]!.frames["frame-2"] = [0, 0, 0, 0];
    const project = createPixelProject({ document, id: "project-lighting-motion" });

    expect(validatePixelProject(project)).toEqual({ valid: true, issues: [] });
    delete project.document.frames[0]!.lighting;
    expect(validatePixelProject(project).issues).toContainEqual({
      path: "/clips/0/frameIds",
      message: "Every clip must keep at least one lighting keyframe."
    });
  });

  it("rejects unknown references and unsupported versions", () => {
    const project = createPixelProject({ id: "project-invalid" });
    project.sources = [{
      id: "duplicate-source",
      name: "one.png",
      kind: "image",
      mimeType: "image/png",
      createdAt: "2026-08-23T00:00:00.000Z"
    }, {
      id: "duplicate-source",
      name: "two.png",
      kind: "image",
      mimeType: "image/png",
      createdAt: "2026-08-23T00:00:00.000Z"
    }];
    expect(validatePixelProject(project).issues).toContainEqual({
      path: "/sources",
      message: "Source IDs must be unique within a Project."
    });

    const unknownFrame = createPixelProject({ id: "project-unknown-frame" });
    unknownFrame.clips[0]!.frameIds = ["missing"];
    expect(validatePixelProject(unknownFrame).issues.some((issue) => issue.message.includes("unknown frame"))).toBe(true);

    const future = { ...createPixelProject({ id: "project-future" }), version: 2 };
    expect(() => parsePixelProject(future)).toThrow("/version");
  });

  it("round-trips retained source frame bindings and rejects unknown bindings", () => {
    const project = createPixelProject({ id: "project-sources" });
    const frameId = project.document.frames[0]!.id;
    project.sources = [{
      id: "source-image",
      name: "robot.png",
      kind: "image",
      mimeType: "image/png",
      digest: "0".repeat(64),
      dataBase64: "AA==",
      frameIds: [frameId],
      createdAt: "2026-08-23T00:00:00.000Z"
    }];

    expect(parsePixelProject(serializePixelProject(project))).toEqual(project);
    project.sources[0]!.frameIds = ["missing-frame"];
    expect(validatePixelProject(project).issues).toContainEqual({
      path: "/sources/0",
      message: "Source frame missing-frame must belong to the Project."
    });
  });

  it("commits one revision per semantic transaction and clones independently", () => {
    const project = createPixelProject({ id: "project-original", name: "Original", now: "2026-08-23T00:00:00.000Z" });
    const committed = commitPixelProject(project, (draft) => {
      draft.document.metadata.modifiedBy = "codex";
    }, "2026-08-23T00:00:01.000Z");
    const clone = clonePixelProject(committed, {
      id: "project-clone",
      name: "Clone",
      now: "2026-08-23T00:00:02.000Z"
    });

    expect(committed.revision).toBe(1);
    expect(project.document.metadata.modifiedBy).not.toBe("codex");
    expect(clone.id).toBe("project-clone");
    expect(clone.revision).toBe(0);
    clone.document.metadata.modifiedBy = "clone";
    expect(committed.document.metadata.modifiedBy).toBe("codex");
  });

  it("does not report saved until persistence acknowledges the revision", async () => {
    let acknowledge: ((value: { revision: number }) => void) | undefined;
    const queue = new ProjectAutosaveQueue(
      () => new Promise((resolve) => { acknowledge = resolve; }),
      0
    );
    const states: string[] = [];
    queue.subscribe((state) => states.push(state.status));
    const next = commitPixelProject(createPixelProject({ id: "project-save" }), (draft) => {
      draft.name = "Changed";
    });

    queue.enqueue(next);
    expect(queue.state.status).toBe("saving");
    acknowledge!({ revision: 1 });
    await queue.flush();

    expect(states).toEqual(["saved", "unsaved", "saving", "saved"]);
    expect(queue.state).toEqual({ status: "saved", savedRevision: 1 });
  });

  it("retains the newest unsaved revision across reconnect and retries it", async () => {
    let available = false;
    const persisted: number[] = [];
    const queue = new ProjectAutosaveQueue(async (project) => {
      if (!available) throw new ProjectUnavailableError("offline");
      persisted.push(project.revision);
      return { revision: project.revision };
    }, 0);
    const initial = createPixelProject({ id: "project-reconnect" });
    const revision1 = commitPixelProject(initial, (draft) => { draft.name = "One"; });
    queue.enqueue(revision1);
    await queue.flush();
    expect(queue.state).toMatchObject({ status: "reconnecting", pendingRevision: 1 });

    const revision2 = commitPixelProject(revision1, (draft) => { draft.name = "Two"; });
    queue.enqueue(revision2);
    await queue.flush();
    expect(queue.state).toMatchObject({ status: "reconnecting", pendingRevision: 2 });

    available = true;
    queue.retry();
    await queue.flush();
    expect(persisted).toEqual([2]);
    expect(queue.state).toEqual({ status: "saved", savedRevision: 2 });
  });
});
