import { createPixelDocument } from "@editable-pixel/document";
import { PixelServerClient } from "@editable-pixel/server/client";
import { startPixelServer } from "@editable-pixel/server";
import { afterEach, describe, expect, it } from "vitest";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("server and client integration", () => {
  it("shares selection, applies a bounded patch, renders, and restores via undo", async () => {
    const server = await startPixelServer();
    closeCallbacks.push(server.close);
    const client = new PixelServerClient({
      pid: process.pid,
      port: server.port,
      daemonToken: server.daemonToken,
      startedAt: new Date(0).toISOString()
    });
    const document = createPixelDocument({ width: 3, height: 3 });
    document.selection = {
      type: "rect", x: 1, y: 1, width: 1, height: 1, layerId: "artwork", frameId: "frame-1"
    };
    const created = await client.createSession({ document });

    await expect(client.getSelection(created.session.id)).resolves.toMatchObject({ selection: document.selection });
    const { patch } = await client.createPatch(created.session.id, {
      reason: "integration pixel",
      changes: [{ x: 1, y: 1, colorIndex: 1 }]
    });
    const preview = await client.previewPatch(created.session.id, patch);
    expect(preview.before.revision).toBe(0);
    expect(preview.after.layers[0]!.frames["frame-1"]![4]).toBe(1);

    const applied = await client.applyPatch(created.session.id, patch.id);
    expect(applied.revision).toBe(1);
    const rendered = await client.renderPreview(created.session.id, { scale: 4 });
    expect(rendered).toMatchObject({ mimeType: "image/png", width: 12, height: 12 });
    expect(Buffer.from(rendered.data, "base64").subarray(1, 4).toString()).toBe("PNG");

    const restored = await client.undo(created.session.id);
    expect(restored.revision).toBe(2);
    expect(restored.document.layers[0]!.frames["frame-1"]![4]).toBe(0);
  });
});
