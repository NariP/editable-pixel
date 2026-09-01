import { createPixelDocument } from "@editable-pixel/document";
import { createPixelProject } from "@editable-pixel/project";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { migrateWorkspaceSnapshot, restoreEmbeddedProjectSources, type ConvertSettings } from "./workspace.js";

const settings: ConvertSettings = {
  canvasWidth: 16,
  canvasHeight: 16,
  colorCount: 8,
  contentScale: 0.8,
  alignment: "center",
  dithering: "none",
  background: "alpha"
};

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:workspace-source");
});

describe("workspace migration", () => {
  it("migrates the active legacy variant into the Project canvas", () => {
    const first = createPixelDocument({ id: "document-v1", width: 2, height: 2 });
    const second = createPixelDocument({ id: "document-v2", width: 2, height: 2 });
    second.layers[0]!.frames["frame-1"]![0] = 1;

    const migrated = migrateWorkspaceSnapshot({
      version: 1,
      draftSettings: settings,
      sources: [{
        id: "source-legacy",
        name: "robot.png",
        mimeType: "image/png",
        variants: [
          { id: "variant-1", name: "V1", document: first, appliedSettings: settings, hasEditsSinceConversion: false, createdAt: "2026-08-21T00:00:00.000Z" },
          { id: "variant-2", name: "V2", document: second, appliedSettings: settings, hasEditsSinceConversion: true, createdAt: "2026-08-22T00:00:00.000Z" }
        ]
      }],
      activeSourceId: "source-legacy",
      activeVariantId: "variant-2",
      activeInspectorTab: "edit"
    });

    expect(migrated?.version).toBe(3);
    expect(migrated?.project.document.layers[0]!.frames["frame-1"]![0]).toBe(1);
    expect(migrated?.project.sources).toHaveLength(1);
    expect(migrated?.sources).toHaveLength(1);
  });

  it("creates a valid source-less project from a blank legacy workspace", () => {
    const migrated = migrateWorkspaceSnapshot({
      version: 1,
      draftSettings: settings,
      workingDocument: createPixelDocument({ width: 4, height: 4 }),
      sources: [],
      activeInspectorTab: "frames"
    });

    expect(migrated?.project.sources).toEqual([]);
    expect(migrated?.project.document.canvas).toEqual({ width: 4, height: 4 });
  });

  it("flattens the active multi-asset workspace into one Project canvas", () => {
    const first = createPixelProject({ id: "project-first", width: 2, height: 2 });
    const second = createPixelProject({
      id: "project-second",
      document: createPixelDocument({ width: 3, height: 3, palette: ["#00000000", "#ff0000ff"], pixels: [1, 0, 0, 0, 0, 0, 0, 0, 0] })
    });
    second.sources = [{
      id: "source-second",
      name: "second.png",
      kind: "image",
      mimeType: "image/png",
      digest: "a".repeat(64),
      createdAt: "2026-08-23T00:00:00.000Z"
    }];

    const migrated = migrateWorkspaceSnapshot({
      version: 2,
      project: {
        format: "pixel-project",
        version: 1,
        id: "legacy-project",
        name: "Legacy Project",
        revision: 7,
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
        assets: [
          { id: "asset-first", name: "First", sources: first.sources, document: first.document, clips: first.clips },
          { id: "asset-second", name: "Second", sources: second.sources, document: second.document, clips: second.clips }
        ],
        active: {
          assetId: "asset-second",
          clipId: second.clips[0]!.id,
          frameId: second.document.frames[0]!.id,
          layerId: second.document.layers[0]!.id
        }
      },
      draftSettings: settings,
      sources: [{ assetId: "asset-second", id: "source-second", name: "second.png", mimeType: "image/png" }],
      activeSourceId: "source-second",
      activeInspectorTab: "frames",
      savedRevision: 7
    });

    expect(migrated?.version).toBe(3);
    expect(migrated?.project.document.canvas).toEqual({ width: 3, height: 3 });
    expect(migrated?.project.sources.map((source) => source.id)).toEqual(["source-second"]);
    expect(migrated?.sources.map((source) => source.id)).toEqual(["source-second"]);
    expect(migrated?.project).not.toHaveProperty("assets");
  });

  it("restores retained source frame bindings from a project file", async () => {
    const project = createPixelProject({ id: "project-embedded" });
    const frameId = project.document.frames[0]!.id;
    const bytes = new TextEncoder().encode("source-image");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    project.sources = [{
      id: "source-embedded",
      name: "source.png",
      kind: "image",
      mimeType: "image/png",
      digest,
      dataBase64: btoa(String.fromCharCode(...bytes)),
      frameIds: [frameId],
      createdAt: "2026-08-23T00:00:00.000Z"
    }];

    const restored = await restoreEmbeddedProjectSources(project);

    expect(restored).toHaveLength(1);
    expect(restored[0]!.sourceBlob?.size).toBe(bytes.byteLength);
    expect(restored[0]!.sourceFrames?.map((frame) => frame.frameId)).toEqual([frameId]);
  });
});
