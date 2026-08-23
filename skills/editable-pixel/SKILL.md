---
name: editable-pixel
description: Convert AI-generated PNG, WebP, or JPEG artwork into editable logical pixel assets, open the local review editor, make selection-bounded edits with Codex or Claude, and validate, render, or export Pixel Documents. Use for AI pixel-asset workflows, not general raster painting.
---

# Editable Pixel

Use the installed `editable-pixel` CLI for file workflows and the `editable-pixel` MCP server for live browser sessions. Never reimplement the Pixel Document schema or patch math in ad-hoc scripts.

## Route the request

- `convert`: run `editable-pixel convert` for one image or a batch. A batch shares palette, canvas, content box, and pivot.
- `open`: run the host-specific flow in [references/hosts.md](references/hosts.md).
- `edit`: use MCP for a live selected area. Read [references/live-editing.md](references/live-editing.md).
- `validate`, `render`, `export`: use the corresponding CLI command; these work without MCP or Web.

Read [references/cli.md](references/cli.md) only when composing non-live commands or diagnosing a CLI error.

## Non-negotiable edit boundary

For conversational edits, the user chooses the rectangle in the web editor. Do not infer, enlarge, or move that selection on their behalf.

Before changing pixels:

1. Identify the active session and current revision.
2. Read the current selection. If absent, ask the user to click `[SELECT AREA]` and drag a rectangle.
3. Create a patch whose every coordinate stays inside that selection.
4. Preview it in the web editor.
5. Apply only after the user approves the preview; otherwise reject it.
6. Re-read the session and validate the resulting document.

Never bypass a stale-revision conflict. Refresh the session, recreate the patch, and preview again.

## Safety and output

- Keep source images and tokens out of logs and chat output.
- Do not overwrite conversion or export files. Choose a new output path when `OUTPUT_EXISTS` is returned.
- Do not use external background-removal services. `local-removal` must be explicitly available; otherwise choose alpha or solid removal with the user.
- Treat `.pixel.json` as the editable source of truth and PNGs as rendered outputs.
- Report the session ID, revision, changed bounds, and output paths; do not dump full pixel arrays unless requested.
