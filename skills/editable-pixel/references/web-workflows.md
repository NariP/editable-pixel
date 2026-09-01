# Connected web workflows

Use these tools only with an open connected browser session. Call `get_web_context` first when the user's request depends on current tab, tool, active Project/Clip/Frame/Layer/Source, conversion settings, playback, Onion Skin, or recent Projects.

## `control_web`

One call applies one semantic browser action:

- `set_view`: tab, inspector, Project Sources disclosure, tool, Color/Normal map, Normal brush value, Normal/Lit preview, palette color, grid, light marker, original comparison, canvas background, zoom, Fit.
- `set_active`: active Source, Clip, Frame, or Layer.
- `set_playback`, `set_onion_skin`: motion preview state.
- `set_conversion`: canvas, colors, Content Frame scale, anchor, dither, background, or fixed palette. A retained Source reconverts through the same live preview path.
- `save_conversion_preset`, `load_conversion_preset`.
- `new_project`, `save_project_as`, `open_recent_project`.
- `delete_recent_project` and `remove_source` require `confirm: true`; use them only when the user requested that deletion.

Browser-only state does not create fake document History entries. Any resulting document or Project mutation uses the shared session, actor=`ai`, revision, autosave, and Undo/Redo path.

## `import_files`

Pass absolute local paths and choose the same purpose shown in the web Import dialog:

- `replace-canvas`: one Pixel JSON or one/more images.
- `add-frames`: one/more images added to the active Clip.
- `add-source`: retain images or Pixel JSON for comparison/reconversion.
- `replace-source`: replace the active retained Source with one file.
- `sprite-sheet`: one image plus `columns` and `rows`.
- `open-project`: one `.pixel-project.json` file.

The MCP rejects relative paths, symlinks, unsupported formats, images over 20MB, and batches over 64MB. File bytes and Source data must not be printed in chat.

## `export_web`

Use the same format/scope/scale model as the header Export popover:

- frame: Color PNG, Normal map, or Lit PNG.
- clip/project: Color, Normal, or Lit Sprite Sheet; GIF.
- project: Project JSON.
- scales: 1×, 2×, 4×, 8×.

`export_web` triggers the browser download. Use `export_frame` instead when the agent needs a concrete server-side output path for one Color/Normal/Lit Frame.
