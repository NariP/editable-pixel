---
name: editable-pixel
description: Inspect and edit Editable Pixel Project or Pixel Document sessions with Codex or Claude. Use for natural-language pixel, palette, layer, frame, clip, normal-map, lighting, conversion, motion, validation, rendering, and export work on AI-generated pixel assets.
---

# Editable Pixel

Use the installed `editable-pixel` CLI for files and session startup. Use the `editable-pixel` MCP server for a live Project shared with the web editor. Never recreate document schemas, coordinate transforms, or patch math in ad-hoc scripts.

## Route the request

- Live inspection or editing: follow [references/live-editing.md](references/live-editing.md).
- Connected-browser state, Project, import, conversion, playback, or export: follow [references/web-workflows.md](references/web-workflows.md).
- Offline convert, validate, render, or bundle export: follow [references/cli.md](references/cli.md).
- Register MCP or open the correct browser host: follow [references/hosts.md](references/hosts.md).

## Live workflow

1. Call `list_sessions` only when the session ID is unknown.
2. Call `get_metadata` to discover Project, Clip, Frame, Layer, canvas, selection, and revision.
3. Call only the smallest required context tool:
   - pixels or normals: `get_design_context`
   - color usage: `get_palette_context`
   - timing or lighting: `get_motion_context`
   - visual semantics or QA: `get_screenshot`
   - active web tab/tool/Source/Project/conversion/playback state: `get_web_context`
4. If the target is not already selected, call `set_selection`. Use the existing selection when it already matches.
5. Plan all changes first. Call `use_editable_pixel` once with `base_revision` and `remap_colors` for multiple shades, or `operations` for mixed edits. Successful items apply immediately as one actor=`ai` History entry; inspect failed/skipped item results.
6. Re-read focused context only when needed. Use `get_history` or `undo` to inspect or revert.

Use `control_web` for browser-only state and Project workflows, `import_files` for validated local inputs, and `export_web` for the same download options exposed by the header Export UI. Do not automate DOM clicks when a semantic MCP action exists.

Do not require a preview approval. Preview and Screenshot are optional QA tools. Never bypass revision, schema, target, or selection validation.

## Context budget

- Prefer `get_metadata` over a full Project or Document dump.
- Do not add colors and replace shades one at a time. Send all original-index→RGBA mappings in one `remap_colors` action. See exact calls in [live editing](references/live-editing.md).
- Reuse compact mutation results for confirmation; re-read only the affected context when needed.
- Prefer the active selection. Otherwise pass explicit bounds or rely on content bounds.
- Start with padding 1; increase only when edge continuity needs more context.
- Request normals only for normal-map tasks.
- Use screenshots to identify semantic regions; use design context for exact coordinates and palette indices.
- Report changed action, target, revision, and bounds. Do not print full pixel arrays unless requested.

## Editing policy

- AI and the user share `document.selection`, session History, Undo, Redo, revision, and autosave.
- Project/Clip actions and AI-driven imports are synchronized back into the visible browser Project model; do not edit Project JSON behind the session.
- Treat one user intent as one `use_editable_pixel` transaction when the action schema supports it.
- Use `set_selection` for rectangle, pixel mask, 2:1 isometric diamond, color, connected component, outline, or content bounds selection.
- Keep exact pixel edits selection-bounded unless the user clearly requested a document-wide palette or structure action.
- Use the supplied reason as a concise History label.
- On conflict, refresh metadata/context and recreate the action against the current state.

## Safety

- Keep source data and session tokens out of logs and chat.
- Never overwrite export files; choose a fresh filename after `OUTPUT_EXISTS`.
- Use only loopback sessions and the installed MCP transport.
- Treat Project/Pixel JSON as editable data and PNG/GIF/Sprite Sheet as outputs.
