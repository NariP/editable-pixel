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

async function createHarness(width = 2, height = 2) {
  const server = await startPixelServer();
  running.push(server);
  const apiClient = new PixelServerClient({
    pid: process.pid,
    port: server.port,
    daemonToken: server.daemonToken,
    startedAt: new Date().toISOString()
  });
  const created = await apiClient.createSession({ document: createPixelDocument({ width, height }) });
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
