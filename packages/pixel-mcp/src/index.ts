#!/usr/bin/env node
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Patch } from "@editable-pixel/core";
import type { EditablePixelAction, SelectionCommand, WebControlCommand, WebImportFile } from "@editable-pixel/server";
import { ClientError, PixelServerClient } from "@editable-pixel/server/client";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { packageVersion } from "./version.js";

const responseFormat = z.enum(["markdown", "json"]).default("markdown").describe(
  "Use markdown for concise human-readable output or json for machine-readable output."
);
const sessionId = z.string().min(8).max(128).describe("Session ID returned by editable-pixel open or list_sessions.");
const universalOutput = z.object({ data: z.unknown() });
type ResponseFormat = z.infer<typeof responseFormat>;

const selectionMode = z.enum(["replace", "add", "remove", "toggle"]).default("replace");
const targetFields = {
  layer_id: z.string().min(1).max(128).optional(),
  frame_id: z.string().min(1).max(128).optional()
};
const coordinate = z.object({
  x: z.number().int().min(0).max(4095),
  y: z.number().int().min(0).max(4095)
}).strict();
const selectionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rect"),
    x: z.number().int().min(0).max(4095),
    y: z.number().int().min(0).max(4095),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    ...targetFields,
    mode: selectionMode
  }).strict(),
  z.object({
    type: z.literal("pixels"),
    pixels: z.array(coordinate).min(1).max(100_000),
    ...targetFields,
    mode: selectionMode
  }).strict(),
  z.object({
    type: z.literal("isometric_diamond"),
    center_x: z.number().int().min(0).max(4095).describe("Diamond center on the pixel canvas x axis."),
    center_y: z.number().int().min(0).max(4095).describe("Diamond center on the pixel canvas y axis."),
    width: z.number().int().min(2).max(4096).describe("Diamond width in canvas pixels. Use twice the height for a 2:1 tile."),
    height: z.number().int().min(1).max(4096).optional().describe("Diamond height in canvas pixels. Defaults to half the width."),
    ...targetFields,
    mode: selectionMode
  }).strict(),
  z.object({
    type: z.literal("color"),
    color_index: z.number().int().min(0).max(255),
    ...targetFields,
    mode: selectionMode
  }).strict(),
  z.object({
    type: z.literal("connected"),
    x: z.number().int().min(0).max(4095),
    y: z.number().int().min(0).max(4095),
    ...targetFields,
    mode: selectionMode
  }).strict(),
  z.object({ type: z.literal("outline"), ...targetFields, mode: selectionMode }).strict(),
  z.object({ type: z.literal("content_bounds"), ...targetFields, mode: selectionMode }).strict(),
  z.object({ type: z.literal("clear") }).strict()
]);

const lightingSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  height: z.number().min(0.05).max(10),
  intensity: z.number().min(0).max(10),
  ambient: z.number().min(0).max(1),
  shading: z.enum(["smooth", "toon-palette"]).optional(),
  toonSteps: z.number().int().min(3).max(6).optional()
}).strict();
const editActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("paint_pixels"),
    pixels: z.array(coordinate.extend({ color_index: z.number().int().min(0).max(255) })).min(1).max(100_000),
    ...targetFields,
    require_selection: z.boolean().optional()
  }).strict(),
  z.object({ type: z.literal("paint_selection"), color_index: z.number().int().min(0).max(255) }).strict(),
  z.object({ type: z.literal("erase_selection") }).strict(),
  z.object({
    type: z.literal("replace_color"),
    from_color_index: z.number().int().min(0).max(255),
    to_color_index: z.number().int().min(0).max(255),
    selection_only: z.boolean().default(false)
  }).strict(),
  z.object({ type: z.literal("move_selection"), dx: z.number().int().min(-4095).max(4095), dy: z.number().int().min(-4095).max(4095) }).strict(),
  z.object({ type: z.literal("flip_selection"), axis: z.enum(["horizontal", "vertical"]) }).strict(),
  z.object({
    type: z.literal("paint_normals"),
    pixels: z.array(coordinate.extend({ normal: z.number().int().min(0).max(0xffffff) })).min(1).max(100_000),
    ...targetFields,
    require_selection: z.boolean().optional()
  }).strict(),
  z.object({ type: z.literal("reset_selection_normals") }).strict(),
  z.object({ type: z.literal("add_palette_color"), color: z.string().regex(/^#[0-9a-fA-F]{8}$/) }).strict(),
  z.object({ type: z.literal("remove_palette_color"), color_index: z.number().int().min(0).max(255), replacement_index: z.number().int().min(0).max(255) }).strict(),
  z.object({ type: z.literal("replace_palette_color"), from_color_index: z.number().int().min(0).max(255), to_color_index: z.number().int().min(0).max(255) }).strict(),
  z.object({ type: z.literal("reorder_palette_color"), from_index: z.number().int().min(0).max(255), to_index: z.number().int().min(0).max(255) }).strict(),
  z.object({ type: z.literal("add_layer"), name: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("remove_layer"), layer_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("duplicate_layer"), layer_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("rename_layer"), layer_id: z.string().min(1).max(128), name: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("reorder_layer"), layer_id: z.string().min(1).max(128), to_index: z.number().int().min(0).max(4095) }).strict(),
  z.object({ type: z.literal("set_layer_visibility"), layer_id: z.string().min(1).max(128), visible: z.boolean() }).strict(),
  z.object({ type: z.literal("set_layer_opacity"), layer_id: z.string().min(1).max(128), opacity: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal("add_frame"), name: z.string().min(1).max(128).optional(), duration_ms: z.number().int().min(1).max(60_000).optional() }).strict(),
  z.object({ type: z.literal("remove_frame"), frame_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("duplicate_frame"), frame_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("rename_frame"), frame_id: z.string().min(1).max(128), name: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("reorder_frame"), frame_id: z.string().min(1).max(128), to_index: z.number().int().min(0).max(4095) }).strict(),
  z.object({ type: z.literal("set_frame_duration"), frame_id: z.string().min(1).max(128), duration_ms: z.number().int().min(1).max(60_000) }).strict(),
  z.object({ type: z.literal("set_frame_lighting"), frame_id: z.string().min(1).max(128), lighting: lightingSchema }).strict(),
  z.object({ type: z.literal("set_lighting_interpolation"), frame_id: z.string().min(1).max(128), interpolation: z.enum(["hold", "linear", "ease-in", "ease-out", "ease-in-out"]) }).strict(),
  z.object({ type: z.literal("remove_lighting_keyframe"), frame_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("create_clip"), name: z.string().min(1).max(256), frame_ids: z.array(z.string().min(1).max(128)).min(1).max(4096) }).strict(),
  z.object({ type: z.literal("remove_clip"), clip_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("rename_clip"), clip_id: z.string().min(1).max(128), name: z.string().min(1).max(256) }).strict(),
  z.object({ type: z.literal("set_clip_frames"), clip_id: z.string().min(1).max(128), frame_ids: z.array(z.string().min(1).max(128)).min(1).max(4096) }).strict(),
  z.object({ type: z.literal("reorder_clip"), clip_id: z.string().min(1).max(128), to_index: z.number().int().min(0).max(4095) }).strict(),
  z.object({ type: z.literal("rename_project"), name: z.string().min(1).max(256) }).strict()
]);

const webConvertSettingsSchema = z.object({
  canvas_width: z.number().int().min(1).max(4096).optional(),
  canvas_height: z.number().int().min(1).max(4096).optional(),
  color_count: z.number().int().min(1).max(256).optional(),
  content_scale: z.number().min(0.25).max(1).optional(),
  alignment: z.enum(["center", "bottom-center"]).optional(),
  dithering: z.enum(["none", "floyd-steinberg"]).optional(),
  background: z.enum(["alpha", "solid", "local-removal"]).optional(),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{8}$/)).min(1).max(256).optional()
}).strict();

const webControlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_view"),
    inspector_tab: z.enum(["convert", "edit", "frames"]).optional(),
    inspector_open: z.boolean().optional(),
    project_scope_open: z.boolean().optional(),
    tool: z.enum(["pen", "eraser", "fill", "select"]).optional(),
    edit_map: z.enum(["color", "normal"]).optional(),
    normal_preview: z.enum(["map", "lit"]).optional(),
    normal_value: z.number().int().min(0).max(0xffffff).optional(),
    color_index: z.number().int().min(0).max(255).optional(),
    show_grid: z.boolean().optional(),
    grid_mode: z.enum(["square", "isometric"]).optional(),
    show_light_marker: z.boolean().optional(),
    compare_mode: z.boolean().optional(),
    canvas_background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    zoom: z.number().min(1).max(48).optional(),
    fit: z.enum(["canvas", "selection"]).optional()
  }).strict(),
  z.object({
    type: z.literal("set_active"),
    source_id: z.string().min(1).max(128).optional(),
    clip_id: z.string().min(1).max(128).optional(),
    frame_id: z.string().min(1).max(128).optional(),
    layer_id: z.string().min(1).max(128).optional()
  }).strict(),
  z.object({ type: z.literal("set_playback"), playing: z.boolean() }).strict(),
  z.object({
    type: z.literal("set_onion_skin"),
    previous: z.boolean().optional(),
    next: z.boolean().optional(),
    opacity: z.number().min(0.1).max(0.8).optional()
  }).strict(),
  z.object({ type: z.literal("set_conversion"), settings: webConvertSettingsSchema }).strict(),
  z.object({ type: z.literal("save_conversion_preset") }).strict(),
  z.object({ type: z.literal("load_conversion_preset"), index: z.number().int().min(0).max(7) }).strict(),
  z.object({ type: z.literal("new_project"), name: z.string().min(1).max(256).optional() }).strict(),
  z.object({ type: z.literal("save_project_as"), name: z.string().min(1).max(256) }).strict(),
  z.object({ type: z.literal("open_recent_project"), project_id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal("delete_recent_project"), project_id: z.string().min(1).max(128), confirm: z.literal(true) }).strict(),
  z.object({ type: z.literal("remove_source"), source_id: z.string().min(1).max(128), confirm: z.literal(true) }).strict()
]);

export function createEditablePixelMcpServer(
  connect: () => Promise<PixelServerClient> = () => PixelServerClient.connect("mcp")
): McpServer {
  const server = new McpServer(
    { name: "editable-pixel-mcp-server", version: packageVersion },
    {
      instructions: "Use get_metadata first, then get_design_context only for the target area. Use get_web_context for browser-only state. Use set_selection and use_editable_pixel for document edits, control_web for semantic UI/project workflows, import_files for local inputs, and export_web for the browser's export formats. AI edits share the browser Selection, History, revision, Undo, Redo, and autosave. Screenshots are optional QA, not an approval gate."
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
      ...(session.projectContext ? { projectContext: session.projectContext } : {}),
      ...(session.selection ? { selection: session.selection } : {}),
      pendingPatchIds: session.pendingPatchIds,
      clients: session.clients,
      createdAt: session.createdAt
    };
    return result(data, response_format, `Session ${data.id}\n- Document: ${data.documentName} (${data.documentId})\n- Revision: ${data.revision}\n- Host: ${data.host}\n- Clients: ${data.clients.join(", ") || "none"}\n- Pending patches: ${data.pendingPatchIds.join(", ") || "none"}`);
  }));

  server.registerTool("get_metadata", {
    title: "Get Editable Pixel Metadata",
    description: "Return sparse Project, Clip, Frame, Layer, canvas, selection, and revision metadata without pixel arrays. Use this before detailed context.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const data = await (await connect()).getMetadata(session_id);
    const project = data.project
      ? `Project ${data.project.name} with ${data.project.clips.length} clip(s) and ${data.project.sourceCount} source(s)`
      : "Pixel Document session without a Project";
    return result(
      data,
      response_format,
      `${project}\n- Canvas: ${data.document.canvas.width}×${data.document.canvas.height}\n- Revision: ${data.document.revision}\n- Layers: ${data.document.layers.length}\n- Frames: ${data.document.frames.length}\n- Palette: ${data.document.paletteSize} colors\n- Selection: ${data.selection ? `${data.selection.type} ${data.selection.x},${data.selection.y} ${data.selection.width}×${data.selection.height}` : "none"}`
    );
  }));

  server.registerTool("get_design_context", {
    title: "Get Editable Pixel Design Context",
    description: "Return palette indices and optional normals only for the active selection, explicit bounds, or content bounds plus small padding. Capped at 65,536 pixels.",
    inputSchema: z.object({
      session_id: sessionId,
      padding: z.number().int().min(0).max(8).default(1),
      include_normals: z.boolean().default(false),
      bounds: z.object({
        x: z.number().int().min(0).max(4095),
        y: z.number().int().min(0).max(4095),
        width: z.number().int().min(1).max(4096),
        height: z.number().int().min(1).max(4096)
      }).strict().optional(),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, padding, include_normals, bounds, response_format }) => tool(async () => {
    const data = await (await connect()).getDesignContext(session_id, {
      padding,
      includeNormals: include_normals,
      ...(bounds ? { bounds } : {})
    });
    return result(
      data,
      response_format,
      `Design context at revision ${data.revision}: layer ${data.target.layerId}, frame ${data.target.frameId}, bounds ${data.bounds.x},${data.bounds.y} ${data.bounds.width}×${data.bounds.height}, ${data.palette.length} palette colors${data.normalValues ? ", normals included" : ""}.`
    );
  }));

  server.registerTool("get_palette_context", {
    title: "Get Palette Context",
    description: "Return palette colors, indices, transparent color, and exact usage counts for the active Layer and Frame.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const data = await (await connect()).getPaletteContext(session_id);
    const used = data.colors.filter((color) => color.usedPixels > 0);
    return result(data, response_format, `Palette at revision ${data.revision}: ${used.length}/${data.colors.length} colors used on ${data.target.layerId}/${data.target.frameId}.`);
  }));

  server.registerTool("get_motion_context", {
    title: "Get Motion Context",
    description: "Return Clips, ordered Frames, durations, lighting keyframes, interpolation, and resolved lighting without pixel arrays.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const data = await (await connect()).getMotionContext(session_id);
    return result(
      data,
      response_format,
      data.clips.map((clip) => `- ${clip.name} (${clip.id}): ${clip.frames.length} frames, ${clip.durationMs}ms`).join("\n")
    );
  }));

  server.registerTool("get_history", {
    title: "Get Unified Edit History",
    description: "Return recent user and AI edits in their shared Undo/Redo order, including actor, reason, revisions, and selection.",
    inputSchema: z.object({
      session_id: sessionId,
      limit: z.number().int().min(1).max(200).default(50),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, limit, response_format }) => tool(async () => {
    const data = await (await connect()).getHistory(session_id, limit);
    const human = data.entries.length
      ? data.entries.map((entry) => `- [${entry.state}] ${entry.actor}: ${entry.reason} (r${entry.revisionBefore}→r${entry.revisionAfter})`).join("\n")
      : "No edits have been recorded in this session.";
    return result(data, response_format, human);
  }));

  server.registerTool("set_selection", {
    title: "Set Browser-Visible Pixel Selection",
    description: "Set, add, remove, toggle, or clear the canonical Selection using a rectangle, coordinates, a 2:1 isometric diamond, palette color, connected component, visible outline, or content bounds. The existing web Selection Tool updates immediately.",
    inputSchema: z.object({
      session_id: sessionId,
      command: selectionCommandSchema,
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, command, response_format }) => tool(async () => {
    const client = await connect();
    const normalized = normalizeSelectionCommand(command) as SelectionCommand;
    const data = await client.setSelectionCommand(session_id, normalized);
    return result(
      data,
      response_format,
      data.selection
        ? `Selected ${data.selection.type} at ${data.selection.x},${data.selection.y} ${data.selection.width}×${data.selection.height}. Revision ${data.revision}.`
        : `Selection cleared. Revision ${data.revision}.`
    );
  }));

  server.registerTool("use_editable_pixel", {
    title: "Use Editable Pixel",
    description: "Immediately apply one validated Pixel, Palette, Layer, Frame, Clip, Normal, Lighting, or Project action. The edit is broadcast to the browser and recorded as actor=ai in the shared Undo/Redo History.",
    inputSchema: z.object({
      session_id: sessionId,
      reason: z.string().min(1).max(500),
      action: editActionSchema,
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, reason, action, response_format }) => tool(async () => {
    const data = await (await connect()).executeAction(
      session_id,
      normalizeEditAction(action) as EditablePixelAction,
      reason
    );
    return result(
      data,
      response_format,
      `Applied ${action.type} immediately as an AI edit. Document revision is now ${data.revision}; use undo to revert.`
    );
  }));

  server.registerTool("get_web_context", {
    title: "Get Editable Pixel Web Context",
    description: "Read the connected browser's active Project, Clip, Frame, Layer, Source, tab, tool, map, view, playback, Onion Skin, conversion settings, presets, recent Projects, and supported browser workflows. Does not return pixel arrays.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const response = await (await connect()).executeWebCommand<Record<string, unknown>>(session_id, { type: "get_context" });
    return result(
      response.result,
      response_format,
      `Read the connected Editable Pixel browser context for session ${session_id}. Use control_web for the listed semantic actions.`
    );
  }));

  server.registerTool("control_web", {
    title: "Control Editable Pixel Web Workflows",
    description: "Apply one semantic browser action: change tabs/tools/view state, activate a Source/Clip/Frame/Layer, control playback or Onion Skin, update conversion settings/presets, create/copy/open a Project, or explicitly remove a recent Project or retained Source. Browser-only state changes do not create fake document history; document-changing conversions and Project loads are recorded by the shared session.",
    inputSchema: z.object({
      session_id: sessionId,
      action: webControlSchema,
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: webWriteAnnotations
  }, async ({ session_id, action, response_format }) => tool(async () => {
    const command = normalizeWebCommand(action) as WebControlCommand;
    const response = await (await connect()).executeWebCommand(session_id, command);
    return result(
      response.result,
      response_format,
      `Applied browser action ${action.type} in session ${session_id}.`
    );
  }));

  server.registerTool("import_files", {
    title: "Import Local Files Into Editable Pixel",
    description: "Read validated local image, Pixel JSON, or Pixel Project files and run the same connected-browser workflow as Replace Canvas, Add Frames, Add/Replace Source, Sprite Sheet, or Open Project. Paths must be absolute regular files; symlinks and unsupported formats are rejected. Individual images are capped at 20MB and the batch at 64MB.",
    inputSchema: z.object({
      session_id: sessionId,
      purpose: z.enum(["replace-canvas", "add-frames", "add-source", "replace-source", "sprite-sheet", "open-project"]),
      paths: z.array(z.string().min(1).max(4096)).min(1).max(64),
      columns: z.number().int().min(1).max(256).optional(),
      rows: z.number().int().min(1).max(256).optional(),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async ({ session_id, purpose, paths, columns, rows, response_format }) => tool(async () => {
    const files = await readWebImportFiles(paths, purpose);
    const response = await (await connect()).executeWebCommand(session_id, {
      type: "import_files",
      purpose,
      files,
      ...(columns !== undefined ? { columns } : {}),
      ...(rows !== undefined ? { rows } : {})
    });
    return result(
      response.result,
      response_format,
      `Imported ${files.length} file(s) with the ${purpose} browser workflow: ${files.map((file) => file.name).join(", ")}.`
    );
  }));

  server.registerTool("export_web", {
    title: "Export From Editable Pixel Web",
    description: "Trigger the connected browser's Export workflow with the same format, scope, and scale options as the UI: Color PNG, Normal map, Lit PNG, GIF, Sprite Sheet, or Project JSON. Use export_frame instead when an agent-readable output path is required.",
    inputSchema: z.object({
      session_id: sessionId,
      format: z.enum(["png", "normal", "lit", "gif", "json"]),
      scope: z.enum(["frame", "clip", "project"]),
      scale: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(1),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, format, scope, scale, response_format }) => tool(async () => {
    const response = await (await connect()).executeWebCommand(session_id, {
      type: "export",
      format,
      scope,
      scale
    });
    return result(
      response.result,
      response_format,
      `Triggered ${scope} ${format} export at ${scale}× in the connected browser.`
    );
  }));

  server.registerTool("get_project_context", {
    title: "Get Active Project Context",
    description: "Read the active Project, Clip, Frame, and Layer identity for a local editor session without returning pixel arrays.",
    inputSchema: z.object({ session_id: sessionId, response_format: responseFormat }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, response_format }) => tool(async () => {
    const data = await (await connect()).getProjectContext(session_id);
    const human = data.context
      ? `Project ${data.context.projectName} (${data.context.projectId})\n- Clip: ${data.context.clipName} (${data.context.clipId})\n- Frame: ${data.context.frameId}\n- Layer: ${data.context.layerName} (${data.context.layerId})\n- Project revision: ${data.context.projectRevision}`
      : "This session is not currently associated with a Pixel Project.";
    return result(data, response_format, human);
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

  server.registerTool("get_selection_context", {
    title: "Get Bounded Selection Pixels",
    description: "Read only the selected pixel indices plus optional surrounding padding, together with the palette and active Project context. The response is capped by the Session Server.",
    inputSchema: z.object({
      session_id: sessionId,
      padding: z.number().int().min(0).max(8).default(1),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: readOnlyAnnotations
  }, async ({ session_id, padding, response_format }) => tool(async () => {
    const data = await (await connect()).getSelectionContext(session_id, padding);
    return result(
      data,
      response_format,
      `Selection context at revision ${data.revision}: ${data.bounds.x},${data.bounds.y} ${data.bounds.width}×${data.bounds.height}, ${data.palette.length} palette colors.`
    );
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

  server.registerTool("get_screenshot", {
    title: "Get Editable Pixel Screenshot",
    description: "Render the current Frame as a nearest-neighbor PNG for visual understanding or post-edit QA. This is optional and does not gate edits.",
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
        { type: "text" as const, text: `Current Editable Pixel screenshot: ${preview.width}×${preview.height}.` }
      ],
      structuredContent: { data }
    };
  }));

  server.registerTool("export_frame", {
    title: "Export Session Frame PNG",
    description: "Write one active-session frame as Color, Normal, or Lit PNG inside the session's allowed output directory. Existing files are never overwritten.",
    inputSchema: z.object({
      session_id: sessionId,
      filename: z.string().min(5).max(255).regex(/^[^/\\]+\.png$/i).describe("A basename ending in .png; paths are not allowed."),
      format: z.enum(["color", "normal", "lit"]).default("color"),
      scale: z.number().int().min(1).max(64).default(1),
      frame_id: z.string().min(1).max(128).optional(),
      response_format: responseFormat
    }).strict(),
    outputSchema: universalOutput,
    annotations: writeAnnotations
  }, async ({ session_id, filename, format, scale, frame_id, response_format }) => tool(async () => {
    const data = await (await connect()).exportFrame(session_id, {
      filename,
      format,
      scale,
      ...(frame_id ? { frameId: frame_id } : {})
    });
    return result(
      data,
      response_format,
      `Exported ${data.format} frame ${data.frameId} at ${data.width}×${data.height} to ${data.path}.`
    );
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

const webWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
} as const;

function normalizeSelectionCommand(command: Record<string, unknown>): Record<string, unknown> {
  if (command.type === "clear") return { type: "clear" };
  return {
    ...command,
    ...(command.layer_id ? { layerId: command.layer_id } : {}),
    ...(command.frame_id ? { frameId: command.frame_id } : {}),
    ...(command.color_index !== undefined ? { colorIndex: command.color_index } : {}),
    ...(command.center_x !== undefined ? { centerX: command.center_x } : {}),
    ...(command.center_y !== undefined ? { centerY: command.center_y } : {}),
    layer_id: undefined,
    frame_id: undefined,
    color_index: undefined,
    center_x: undefined,
    center_y: undefined
  };
}

function normalizeEditAction(action: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...action };
  const keys: Array<[string, string]> = [
    ["layer_id", "layerId"],
    ["frame_id", "frameId"],
    ["clip_id", "clipId"],
    ["require_selection", "requireSelection"],
    ["selection_only", "selectionOnly"],
    ["color_index", "colorIndex"],
    ["replacement_index", "replacementIndex"],
    ["from_color_index", "fromColorIndex"],
    ["to_color_index", "toColorIndex"],
    ["from_index", "fromIndex"],
    ["to_index", "toIndex"],
    ["duration_ms", "durationMs"],
    ["frame_ids", "frameIds"]
  ];
  for (const [source, target] of keys) {
    if (normalized[source] !== undefined) normalized[target] = normalized[source];
    delete normalized[source];
  }
  if (Array.isArray(normalized.pixels)) {
    normalized.pixels = normalized.pixels.map((pixel) => {
      const value = { ...(pixel as Record<string, unknown>) };
      if (value.color_index !== undefined) value.colorIndex = value.color_index;
      delete value.color_index;
      return value;
    });
  }
  return normalized;
}

function normalizeWebCommand(action: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...action };
  const keys: Array<[string, string]> = [
    ["inspector_tab", "inspectorTab"],
    ["inspector_open", "inspectorOpen"],
    ["project_scope_open", "projectScopeOpen"],
    ["edit_map", "editMap"],
    ["normal_preview", "normalPreview"],
    ["normal_value", "normalValue"],
    ["color_index", "colorIndex"],
    ["show_grid", "showGrid"],
    ["grid_mode", "gridMode"],
    ["show_light_marker", "showLightMarker"],
    ["compare_mode", "compareMode"],
    ["canvas_background", "canvasBackground"],
    ["source_id", "sourceId"],
    ["clip_id", "clipId"],
    ["frame_id", "frameId"],
    ["layer_id", "layerId"],
    ["project_id", "projectId"]
  ];
  for (const [source, target] of keys) {
    if (normalized[source] !== undefined) normalized[target] = normalized[source];
    delete normalized[source];
  }
  if (normalized.settings && typeof normalized.settings === "object") {
    const settings = { ...(normalized.settings as Record<string, unknown>) };
    for (const [source, target] of [
      ["canvas_width", "canvasWidth"],
      ["canvas_height", "canvasHeight"],
      ["color_count", "colorCount"],
      ["content_scale", "contentScale"]
    ] as Array<[string, string]>) {
      if (settings[source] !== undefined) settings[target] = settings[source];
      delete settings[source];
    }
    normalized.settings = settings;
  }
  return normalized;
}

async function readWebImportFiles(
  paths: string[],
  purpose: "replace-canvas" | "add-frames" | "add-source" | "replace-source" | "sprite-sheet" | "open-project"
): Promise<WebImportFile[]> {
  if ((purpose === "replace-source" || purpose === "sprite-sheet" || purpose === "open-project") && paths.length !== 1) {
    throw new Error(`${purpose} requires exactly one local file.`);
  }
  let total = 0;
  const files: WebImportFile[] = [];
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error(`Import paths must be absolute: ${path}`);
    const resolved = resolve(path);
    const canonical = await realpath(resolved);
    if (canonical !== resolved) throw new Error(`Symlinked import paths are not allowed: ${path}`);
    const info = await lstat(canonical);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Import path is not a regular file: ${path}`);
    const mimeType = webImportMime(canonical);
    const image = mimeType.startsWith("image/");
    if ((purpose === "add-frames" || purpose === "sprite-sheet") && !image) {
      throw new Error(`${purpose} accepts PNG, WebP, or JPEG images only.`);
    }
    if (purpose === "open-project" && !basename(canonical).toLowerCase().endsWith(".pixel-project.json")) {
      throw new Error("open-project requires a .pixel-project.json file.");
    }
    const perFileLimit = image ? 20 * 1024 * 1024 : 64 * 1024 * 1024;
    if (info.size > perFileLimit) throw new Error(`${basename(canonical)} exceeds the ${Math.floor(perFileLimit / 1024 / 1024)}MB file limit.`);
    total += info.size;
    if (total > 64 * 1024 * 1024) throw new Error("The import batch exceeds 64MB.");
    files.push({
      name: basename(canonical),
      mimeType,
      dataBase64: (await readFile(canonical)).toString("base64")
    });
  }
  return files;
}

function webImportMime(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".json") return "application/json";
  throw new Error(`Unsupported import format: ${extension || "no extension"}. Use PNG, WebP, JPEG, Pixel JSON, or Pixel Project JSON.`);
}

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
