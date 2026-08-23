# Live selection edit

Use these MCP tools in order:

1. `list_sessions` when the session ID is unknown.
2. `get_session` and `get_document_summary` to capture the document ID, current revision, palette, layer, and frame.
3. `get_selection`. Stop and request `[SELECT AREA]` when it reports no selection.
4. `create_patch` with explicit `(x, y, color_index)` changes and `require_selection: true`.
5. `preview_patch` using the exact patch returned in the previous result.
6. Wait for the user's apply or reject decision.
7. `apply_patch` by pending patch ID, or `reject_patch`.
8. `get_session` to confirm the new revision, then `validate_document` if the document JSON is part of the task.

`create_patch` records the base revision, before values, affected bounds, and outside-selection hash. Do not hand-edit those fields. Preview is read-only; apply persists the document and notifies the web editor.

When the requested color is not in the current palette, include it as `new_colors: ["#RRGGBBAA"]` and use the appended index in `color_index`. Palette addition and pixel changes are one reviewed patch; coordinates outside the active selection remain invalid.

Use `render_preview` for a visual check without writing a file. Use CLI `render` or `export` when the user wants files.
