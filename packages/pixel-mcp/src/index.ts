#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Patch } from "@editable-pixel/core";
import { ClientError, PixelServerClient } from "@editable-pixel/server/client";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const responseFormat = z.enum(["markdown", "json"]).default("markdown").describe(
  "Use markdown for concise human-readable output or json for machine-readable output."
);
const sessionId = z.string().min(8).max(128).describe("Session ID returned by editable-pixel open or list_sessions.");
const universalOutput = z.object({ data: z.unknown() });
type ResponseFormat = z.infer<typeof responseFormat>;

export function createEditablePixelMcpServer(
  connect: () => Promise<PixelServerClient> = () => PixelServerClient.connect("mcp")
): McpServer {
  const server = new McpServer(
    { name: "editable-pixel-mcp-server", version: "1.0.0" },
    {
      instructions: "Inspect the active session and selection before editing. Create and preview a bounded patch before apply_patch. If get_selection reports none, ask the user to click [SELECT AREA] and drag a rectangle in the web editor."
    }
  );

  server.registerTool("list_sessions", {
    title: "List Editable Pixel Sessions",
    description: "List active local pixel editor sessions. Read-only. Use this first when the user did not provide a session ID.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum sessions to return."),
      offset: z.number().int().min(0).default(0).describe("Number of sessions to skip."),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ limit, offset, response_format }) => tool(async () => {
    const sessions = await (await connect()).listSessions();
    const items = sessions.slice(offset, offset + limit);
    const data = {
      total: sessions.length,
      count: items.length,
      offset,
      sessions: items,
      has_more: offset + items.length < sessions.length,
      ...(offset + items.length < sessions.length ? { next_offset: offset + items.length } : {})
    };
    return result(data, response_format, items.length
      ? items.map((item) => `- ${item.id}: ${item.documentName}, revision ${item.revision}, host ${item.host}, clients ${item.clients.join(", ") || "none"}`).join("\n")
      : "No active sessions. Run `editable-pixel open <document>` first."
    );
  }));

  server.registerTool("get_session", {
    title: "Get Editable Pixel Session",
    description: "Get session state, revision, active clients, pending patches, and document identity without returning the full pixel arrays.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const session = await (await connect()).getSession(session_id);
    const data = {
      id: session.id,
      documentId: session.documentId,
      revision: session.revision,
      documentName: session.documentName,
      host: session.host,
      ...(session.selection ? { selection: session.selection } : {}),
      pendingPatchIds: session.pendingPatchIds,
      clients: session.clients,
      createdAt: session.createdAt
    };
    return result(data, response_format, `Session ${data.id}\n- Document: ${data.documentName} (${data.documentId})\n- Revision: ${data.revision}\n- Host: ${data.host}\n- Clients: ${data.clients.join(", ") || "none"}\n- Pending patches: ${data.pendingPatchIds.join(", ") || "none"}`);
  }));

  server.registerTool("get_document_summary", {
    title: "Get Pixel Document Summary",
    description: "Read canvas, palette, layers, frames, bounds, alignment, pivot, and revision for one session without returning pixel arrays.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const session = await (await connect()).getSession(session_id);
    const document = session.document;
    const data = {
      id: document.id,
      revision: document.revision,
      canvas: document.canvas,
      palette: document.palette,
      transparentColorIndex: document.transparentColorIndex,
      frames: document.frames,
      layers: document.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode
      })),
      contentBox: document.contentBox,
      contentBounds: document.contentBounds,
      alignment: document.alignment,
      pivot: document.pivot,
      regions: document.regions
    };
    return result(data, response_format, `Pixel Document ${data.id} at revision ${data.revision}\n- Canvas: ${data.canvas.width}×${data.canvas.height}\n- Palette: ${data.palette.length} colors\n- Layers: ${data.layers.map((layer) => layer.name).join(", ")}\n- Frames: ${data.frames.length}\n- Content: ${data.contentBounds.x},${data.contentBounds.y} ${data.contentBounds.width}×${data.contentBounds.height}`);
  }));

  server.registerTool("get_selection", {
    title: "Get Browser Selection",
    description: "Read the rectangle or pixel mask currently selected by the user in the web editor. Call before any bounded edit.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const data = await (await connect()).getSelection(session_id);
    const human = data.selection
      ? `Selection: type=${data.selection.type}, x=${data.selection.x}, y=${data.selection.y}, width=${data.selection.width}, height=${data.selection.height}${data.selection.type === "mask" ? `, pixels=${data.selection.indices.length}` : ""}, layer=${data.selection.layerId}, frame=${data.selection.frameId}.`
      : "No selection is active. Ask the user to click [SELECT AREA] in the editor and drag a rectangle, then call get_selection again.";
    return result(data, response_format, human);
  }));

  server.registerTool("create_patch", {
    title: "Create Bounded Pixel Patch",
    description: "Create a deterministic pixel patch against the current session revision. By default an active browser selection is required and every changed coordinate must stay inside it. This does not preview or apply the patch.",
    inputSchema: z.object({
      session_id: sessionId,
      reason: z.string().min(1).max(500).describe("Concise user-requested change reason."),
      layer_id: z.string().min(1).max(128).optional().describe("Defaults to the selected layer."),
      frame_id: z.string().min(1).max(128).optional().describe("Defaults to the selected frame."),
      require_selection: z.boolean().default(true).describe("Keep true for conversational edits."),
      new_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{8}$/)).max(32).optional().describe(
        "RGBA colors to append atomically before the pixel changes. New color indices follow the current palette in this order."
      ),
      changes: z.array(z.object({
        x: z.number().int().min(0).max(4095),
        y: z.number().int().min(0).max(4095),
        color_index: z.number().int().min(0).max(255)
      }).strict()).min(1).max(100_000),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ session_id, reason, layer_id, frame_id, require_selection, new_colors, changes, response_format }) => tool(async () => {
    const data = await (await connect()).createPatch(session_id, {
      reason,
      ...(layer_id ? { layerId: layer_id } : {}),
      ...(frame_id ? { frameId: frame_id } : {}),
      requireSelection: require_selection,
      ...(new_colors?.length ? { newColors: new_colors } : {}),
      changes: changes.map(({ x, y, color_index }) => ({ x, y, colorIndex: color_index }))
    });
    const patch = data.patch;
    return result(data, response_format, `Created patch ${patch.id} for revision ${patch.baseRevision}. Next call preview_patch with this patch; do not apply it before review.`);
  }));

  server.registerTool("preview_patch", {
    title: "Preview Pixel Patch",
    description: "Validate a patch against the current revision and send its before/after preview to the connected web editor. Does not change the document.",
    inputSchema: z.object({ session_id: sessionId, patch: z.json(), response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, patch, response_format }) => tool(async () => {
    const data = await (await connect()).previewPatch(session_id, patch as unknown as Patch);
    return result(data, response_format, `Patch ${data.patch.id} is visible in the web editor for review. Apply it only after the user's explicit instruction.`);
  }));

  server.registerTool("apply_patch", {
    title: "Apply Reviewed Pixel Patch",
    description: "Apply a previously previewed patch by ID, persist it, increment revision, and notify the web editor. This modifies the document.",
    inputSchema: z.object({ session_id: sessionId, patch_id: z.string().min(1).max(128), response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, patch_id, response_format }) => tool(async () => {
    const data = await (await connect()).applyPatch(session_id, patch_id);
    return result(data, response_format, `Applied patch ${patch_id}. Document revision is now ${data.revision}.`);
  }));

  server.registerTool("reject_patch", {
    title: "Reject Pending Pixel Patch",
    description: "Discard a pending patch preview without modifying the document.",
    inputSchema: z.object({ session_id: sessionId, patch_id: z.string().min(1).max(128), response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, patch_id, response_format }) => tool(async () => {
    const data = await (await connect()).rejectPatch(session_id, patch_id);
    return result(data, response_format, `Rejected patch ${patch_id}. Revision remains ${data.revision}.`);
  }));

  for (const action of ["undo", "redo"] as const) {
    server.registerTool(action, {
      title: `${action === "undo" ? "Undo" : "Redo"} Pixel Edit`,
      description: `${action === "undo" ? "Undo the latest applied edit" : "Redo the latest undone edit"}, persist the result, and notify the web editor.`,
      inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
      outputSchema: universalOutput,
      annotations: writeAnnotations
    }, async ({ session_id, response_format }) => tool(async () => {
      const data = action === "undo"
        ? await (await connect()).undo(session_id)
        : await (await connect()).redo(session_id);
      return result(data, response_format, `${action === "undo" ? "Undo" : "Redo"} complete. Revision ${data.revision}.`);
    }));
  }

  server.registerTool("validate_document", {
    title: "Validate Pixel Document",
    description: "Validate a supplied Pixel Document JSON through the local Session Server schema and semantic checks.",
    inputSchema: z.object({ document: z.json(), response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ document, response_format }) => tool(async () => {
    const data = await (await connect()).validateDocument(document);
    return result(data, response_format, data.valid
      ? "The Pixel Document is valid."
      : `The Pixel Document is invalid:\n${data.issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`
    );
  }));

  server.registerTool("render_preview", {
    title: "Render Pixel Preview",
    description: "Render a nearest-neighbor PNG preview of a session document through the local Session Server.",
    inputSchema: z.object({
      session_id: sessionId,
      scale: z.number().int().min(1).max(64).default(8),
      frame_id: z.string().min(1).max(128).optional()
    }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, scale, frame_id }) => tool(async () => {
    const preview = await (await connect()).renderPreview(session_id, {
      scale,
      ...(frame_id ? { frameId: frame_id } : {})
    });
    const data = { mimeType: preview.mimeType, width: preview.width, height: preview.height };
    return {
      content: [
        { type: "image" as const, data: preview.data, mimeType: preview.mimeType },
        { type: "text" as const, text: `Rendered ${preview.width}×${preview.height} nearest-neighbor preview.` }
      ],
      structuredContent: { data }
    };
  }));

  return server;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

function result(data: unknown, format: ResponseFormat, markdown: string) {
  return {
    content: [{ type: "text" as const, text: format === "json" ? JSON.stringify(data, null, 2) : markdown }],
    structuredContent: { data }
  };
}

async function tool<T>(operation: () => Promise<T>): Promise<T | {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: { data: { error: { code: string; message: string; next_action: string } } };
}> {
  try {
    return await operation();
  } catch (error) {
    const code = error instanceof ClientError ? error.code : "MCP_TOOL_ERROR";
    const message = error instanceof Error ? error.message : "The tool could not complete the request.";
    const nextAction = code === "SELECTION_REQUIRED"
      ? "Ask the user to click [SELECT AREA], drag a rectangle, then call get_selection."
      : code === "SERVER_NOT_RUNNING" || code === "SERVER_UNREACHABLE"
        ? "Run editable-pixel open <document> and retry."
        : "Refresh the session with get_session and retry with the current revision.";
    const data = { error: { code, message, next_action: nextAction } };
    return {
      isError: true,
      content: [{ type: "text", text: `Error [${code}]: ${message}\nNext action: ${nextAction}` }],
      structuredContent: { data }
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveStdio(() => createEditablePixelMcpServer(), {
    onerror: (error) => console.error(`Editable Pixel MCP error: ${error.message}`)
  });
}
