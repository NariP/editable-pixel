import { createPixelDocument } from "@editable-pixel/document";
import { PixelServerClient } from "@editable-pixel/server/client";
import { startPixelServer, type RunningPixelServer } from "@editable-pixel/server";
import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createEditablePixelMcpServer } from "./index.js";

const running: RunningPixelServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe("Editable Pixel MCP", () => {
  it("registers the complete required tool surface with annotations", async () => {
    const harness = await createHarness();
    const listed = await harness.mcpClient.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "list_sessions",
      "get_session",
      "get_metadata",
      "get_design_context",
      "get_palette_context",
      "get_motion_context",
      "get_history",
      "set_selection",
      "use_editable_pixel",
      "get_web_context",
      "control_web",
      "import_files",
      "export_web",
      "get_project_context",
      "get_document_summary",
      "get_selection",
      "get_selection_context",
      "create_patch",
      "preview_patch",
      "apply_patch",
      "reject_patch",
      "undo",
      "redo",
      "validate_document",
      "render_preview",
      "get_screenshot",
      "export_frame"
    ]);
    expect(listed.tools.every((tool) => Boolean(tool.description && tool.annotations))).toBe(true);
    await harness.close();
  });

  it("guides the agent when a required browser selection is missing", async () => {
    const harness = await createHarness();
    const result = await harness.mcpClient.callTool({
      name: "create_patch",
      arguments: {
        session_id: harness.sessionId,
        reason: "Add one highlight pixel",
        changes: [{ x: 0, y: 0, color_index: 1 }]
      }
    }) as CallToolResult;

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("SELECT AREA");
    await harness.close();
  });

  it("creates, previews, applies, and renders a selected patch through the Session API", async () => {
    const harness = await createHarness();
    harness.server.store.setSelection(harness.sessionId, {
      type: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layerId: "artwork",
      frameId: "frame-1"
    });
    const created = await harness.mcpClient.callTool({
      name: "create_patch",
      arguments: {
        session_id: harness.sessionId,
        reason: "Add one highlight pixel",
        changes: [{ x: 0, y: 0, color_index: 1 }],
        response_format: "json"
      }
    }) as CallToolResult;
    const patch = (created.structuredContent as { data: { patch: unknown } }).data.patch;
    const previewed = await harness.mcpClient.callTool({
      name: "preview_patch",
      arguments: { session_id: harness.sessionId, patch, response_format: "json" }
    }) as CallToolResult;
    expect(previewed.isError).not.toBe(true);
    const patchId = (patch as { id: string }).id;
    await harness.mcpClient.callTool({
      name: "apply_patch",
      arguments: { session_id: harness.sessionId, patch_id: patchId }
    });
    const rendered = await harness.mcpClient.callTool({
      name: "render_preview",
      arguments: { session_id: harness.sessionId, scale: 2 }
    }) as CallToolResult;

    expect(harness.server.store.get(harness.sessionId).revision).toBe(2);
    expect(rendered.content.some((item) => item.type === "image")).toBe(true);
    const context = await harness.mcpClient.callTool({
      name: "get_selection_context",
      arguments: { session_id: harness.sessionId, padding: 0, response_format: "json" }
    }) as CallToolResult;
    expect(context.isError).not.toBe(true);
    await harness.close();
  });

  it("sets the browser selection and immediately records an AI edit in unified history", async () => {
    const harness = await createHarness();
    const selected = await harness.mcpClient.callTool({
      name: "set_selection",
      arguments: {
        session_id: harness.sessionId,
        command: { type: "rect", x: 1, y: 1, width: 1, height: 1, mode: "replace" },
        response_format: "json"
      }
    }) as CallToolResult;
    expect(selected.isError).not.toBe(true);
    expect(harness.server.store.get(harness.sessionId).selection).toMatchObject({ x: 1, y: 1 });

    const edited = await harness.mcpClient.callTool({
      name: "use_editable_pixel",
      arguments: {
        session_id: harness.sessionId,
        reason: "Paint the selected accent",
        action: { type: "paint_selection", color_index: 1 },
        response_format: "json"
      }
    }) as CallToolResult;
    expect(edited.isError).not.toBe(true);
    expect(harness.server.store.get(harness.sessionId).document.layers[0]!.frames["frame-1"]![3]).toBe(1);

    const history = await harness.mcpClient.callTool({
      name: "get_history",
      arguments: { session_id: harness.sessionId, response_format: "json" }
    }) as CallToolResult;
    const entries = (history.structuredContent as {
      data: { entries: Array<{ actor: string; reason: string }> }
    }).data.entries;
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "ai", reason: "Paint the selected accent" })
    ]));
    await harness.mcpClient.callTool({
      name: "undo",
      arguments: { session_id: harness.sessionId }
    });
    expect(harness.server.store.get(harness.sessionId).document.layers[0]!.frames["frame-1"]![3]).toBe(0);
    await harness.close();
  });

  it("maps a 2:1 isometric diamond to the canonical browser Selection", async () => {
    const harness = await createHarness(8, 4);
    const selected = await harness.mcpClient.callTool({
      name: "set_selection",
      arguments: {
        session_id: harness.sessionId,
        command: {
          type: "isometric_diamond",
          center_x: 4,
          center_y: 2,
          width: 8,
          height: 4,
          mode: "replace"
        },
        response_format: "json"
      }
    }) as CallToolResult;

    expect(selected.isError).not.toBe(true);
    expect(harness.server.store.get(harness.sessionId).selection).toMatchObject({
      type: "mask",
      x: 1,
      y: 0,
      width: 6,
      height: 4
    });
    expect(harness.server.store.get(harness.sessionId).selection).toHaveProperty("indices", expect.any(Array));
    await harness.close();
  });
});

describe("compact partial MCP transactions", () => {
  it("changes sixteen shades in one call, protects 2687 cells, and restores all 1409 cells with one Undo/Redo", async () => {
    const palette = ["#00000000", ...Array.from({ length: 16 }, (_, index) => `#${(index + 1).toString(16).padStart(2, "0")}0000ff`)];
    const pixels = Array.from({ length: 4096 }, (_, index) => index >= 1409 && index % 5 === 0 ? 0 : index % 16 + 1);
    const document = createPixelDocument({ width: 64, height: 64, palette, pixels });
    document.selection = { type: "mask", layerId: "artwork", frameId: "frame-1", x: 0, y: 0, width: 64, height: 23, indices: Array.from({ length: 1409 }, (_, index) => index) };
    const harness = await createHarness(64, 64, document);
    const result = await harness.mcpClient.callTool({ name: "use_editable_pixel", arguments: {
      session_id: harness.sessionId, reason: "All sixteen shades", base_revision: 0,
      action: { type: "remap_colors", selection_only: true, mappings: palette.slice(1).map((_, index) => ({ id: `shade-${index}`, from_color_index: index + 1, to_color: `#00${(index + 1).toString(16).padStart(2, "0")}00ff` })) }, response_format: "json"
    } }) as CallToolResult;
    expect(result.isError).not.toBe(true);
    const summary = (result.structuredContent as { data: { committed: boolean; changedPixels: number; revision: number } }).data;
    expect(summary).toMatchObject({ committed: true, changedPixels: 1409, revision: 1 });
    const next = harness.server.store.get(harness.sessionId).document;
    expect(next.layers[0]!.frames["frame-1"]!.slice(1409)).toEqual(pixels.slice(1409));
    for (let index = 0; index < 1409; index++) expect(next.palette[next.layers[0]!.frames["frame-1"]![index]!]!).toBe(`#00${(index % 16 + 1).toString(16).padStart(2, "0")}00ff`);
    expect(harness.server.store.getHistory(harness.sessionId).entries).toHaveLength(1);
    for (const name of ["undo", "redo"]) {
      const response = await harness.mcpClient.callTool({ name, arguments: { session_id: harness.sessionId, response_format: "json" } }) as CallToolResult;
      expect(response.isError).not.toBe(true);
      expect(JSON.stringify(response)).not.toMatch(/"(document|pixels|normalFrames|indices)":/);
      expect(harness.server.store.get(harness.sessionId).document.layers).toEqual(name === "undo" ? document.layers : next.layers);
      expect(harness.server.store.get(harness.sessionId).document.palette).toEqual(name === "undo" ? document.palette : next.palette);
    }
    await harness.close();
  });

  it("lets invalid nested items reach partial validation and reports failed mapping IDs", async () => {
    const harness = await createHarness();
    const response = await harness.mcpClient.callTool({ name: "use_editable_pixel", arguments: {
      session_id: harness.sessionId, reason: "Partial items", base_revision: 0,
      operations: [
        { id: "invalid", action: { type: "set_frame_duration", duration_ms: "wrong" } },
        { id: "dependent", depends_on: ["invalid"], action: { type: "rename_frame", frame_id: "frame-1", name: "Skip" } },
        { id: "good", action: { type: "set_frame_duration", frame_id: "frame-1", duration_ms: 120 } },
        { id: "colors", action: { type: "remap_colors", targets: [{ layer_id: "artwork", frame_id: "frame-1" }], mappings: [{ id: "bad-color", from_color_index: 1, to_color: "wrong" }] } }
      ]
    } }) as CallToolResult;
    expect(response.isError).not.toBe(true);
    const data = (response.structuredContent as { data: { results: Array<{ id: string; status: string; items?: Array<{ id: string; code: string }> }> } }).data;
    expect(data.results.map((item) => item.status)).toEqual(["failed", "skipped", "applied", "failed"]);
    expect(data.results[3]!.items).toEqual([expect.objectContaining({ id: "bad-color", code: "INVALID_COLOR" })]);
    expect(harness.server.store.get(harness.sessionId).document.frames[0]!.durationMs).toBe(120);
    const stale = await harness.mcpClient.callTool({ name: "use_editable_pixel", arguments: {
      session_id: harness.sessionId, reason: "Stale", base_revision: 0, operations: [{ id: "x", action: { type: "erase_selection" } }]
    } }) as CallToolResult;
    expect(stale.isError).toBe(true);
    expect(JSON.stringify(stale)).toContain("REVISION_CONFLICT");
    await harness.close();
  });

  it("keeps timing, selection and history mutation outputs free of document buffers in text and structured content", async () => {
    for (const format of [undefined, "json"] as const) {
      const sizes: number[] = [];
      const responseFormat = format ? { response_format: format } : {};
      for (const size of [64, 128]) {
        const harness = await createHarness(size, size);
        const changed = await harness.mcpClient.callTool({ name: "use_editable_pixel", arguments: {
          session_id: harness.sessionId, reason: "Timing", action: { type: "set_frame_duration", frame_id: "frame-1", duration_ms: 120 }, ...responseFormat
        } }) as CallToolResult;
        sizes.push(JSON.stringify(changed).length);
        assertCompactMutation(changed, true);
        const selected = await harness.mcpClient.callTool({ name: "set_selection", arguments: {
          session_id: harness.sessionId, command: { type: "pixels", pixels: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }, ...responseFormat
        } }) as CallToolResult;
        assertCompactMutation(selected, format === "json");
        for (const name of ["undo", "redo"]) {
          const result = await harness.mcpClient.callTool({ name, arguments: { session_id: harness.sessionId, ...responseFormat } }) as CallToolResult;
          assertCompactMutation(result, format === "json");
        }
        await harness.close();
      }
      expect(Math.abs(sizes[1]! - sizes[0]!)).toBeLessThan(32);
    }
  });
});

function assertCompactMutation(result: CallToolResult, jsonText: boolean): void {
  expect(result.isError).not.toBe(true);
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect(["document", "pixels", "normalFrames", "indices", "layers"], `Unexpected buffer field ${key}`).not.toContain(key);
      inspect(child);
    }
  };
  expect(result.structuredContent).toHaveProperty("data.revision");
  inspect(result.structuredContent);
  const texts = result.content.filter((item) => item.type === "text");
  expect(texts).toHaveLength(1);
  for (const item of texts) {
    if (jsonText) {
      const decoded: unknown = JSON.parse(item.text);
      expect(decoded).toHaveProperty("revision");
      inspect(decoded);
    } else {
      expect(item.text.length).toBeLessThan(512);
      expect(item.text).not.toMatch(/"(?:document|pixels|normalFrames|indices|layers)"\s*:/);
    }
  }
}

async function createHarness(width = 2, height = 2, document = createPixelDocument({ width, height })) {
  const server = await startPixelServer();
  running.push(server);
  const apiClient = new PixelServerClient({
    pid: process.pid,
    port: server.port,
    daemonToken: server.daemonToken,
    startedAt: new Date().toISOString()
  });
  const created = await apiClient.createSession({ document });
  const mcpServer = createEditablePixelMcpServer(async () => apiClient);
  const mcpClient = new Client({ name: "editable-pixel-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return {
    server,
    sessionId: created.session.id,
    mcpClient,
    close: async () => {
      await mcpClient.close();
      await mcpServer.close();
      const index = running.indexOf(server);
      if (index >= 0) running.splice(index, 1);
      await server.close();
    }
  };
}
