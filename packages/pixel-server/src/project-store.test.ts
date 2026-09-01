import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProjectRevisionConflictError,
  commitPixelProject,
  createPixelProject
} from "@editable-pixel/project";
import { afterEach, describe, expect, it } from "vitest";

import { FileProjectStore } from "./project-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createStore(): Promise<FileProjectStore> {
  const directory = await mkdtemp(join(tmpdir(), "editable-pixel-project-test-"));
  temporaryDirectories.push(directory);
  return new FileProjectStore(directory);
}

describe("FileProjectStore", () => {
  it("creates and opens a source-less project", async () => {
    const store = await createStore();
    const project = createPixelProject({ id: "project-empty", name: "Empty" });

    await store.create(project);

    expect(await store.open(project.id)).toEqual(project);
    expect(JSON.parse(await readFile(store.pathFor(project.id), "utf8"))).toEqual(project);
  });

  it("persists atomically with optimistic revision checks", async () => {
    const store = await createStore();
    const project = createPixelProject({ id: "project-revisions" });
    await store.create(project);
    const revision1 = commitPixelProject(project, (draft) => { draft.name = "Revision 1"; });

    await expect(store.persist(revision1, 0)).resolves.toEqual(revision1);
    await expect(store.persist({ ...revision1, revision: 2 }, 0)).rejects.toBeInstanceOf(ProjectRevisionConflictError);
    expect((await store.open(project.id)).name).toBe("Revision 1");
  });

  it("clones the entire project under a new ID", async () => {
    const store = await createStore();
    const source = createPixelProject({ id: "project-source", name: "Source" });
    source.document.layers[0]!.frames["frame-1"]![0] = 1;
    await store.create(source);

    const clone = await store.clone(source.id, {
      id: "project-copy",
      name: "Copy",
      now: "2026-08-23T00:00:00.000Z"
    });

    expect(clone.id).toBe("project-copy");
    expect(clone.revision).toBe(0);
    expect(clone.document).toEqual(source.document);
    expect(clone.clips).toEqual(source.clips);
    const changedClone = commitPixelProject(clone, (draft) => { draft.name = "Changed Copy"; });
    await store.persist(changedClone, 0);
    expect((await store.open(source.id)).name).toBe("Source");
  });

  it("rejects traversal-like project IDs", async () => {
    const store = await createStore();

    expect(() => store.pathFor("../outside")).toThrow("must not contain a path");
  });
});
