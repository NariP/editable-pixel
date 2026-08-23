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
      "get_document_summary",
      "get_selection",
      "create_patch",
      "preview_patch",
      "apply_patch",
      "reject_patch",
      "undo",
      "redo",
      "validate_document",
      "render_preview"
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
    await harness.close();
  });
});

async function createHarness() {
  const server = await startPixelServer();
  running.push(server);
  const apiClient = new PixelServerClient({
    pid: process.pid,
    port: server.port,
    daemonToken: server.daemonToken,
    startedAt: new Date().toISOString()
  });
  const created = await apiClient.createSession({ document: createPixelDocument({ width: 2, height: 2 }) });
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
