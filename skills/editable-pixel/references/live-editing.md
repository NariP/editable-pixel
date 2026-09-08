# Live editing recipes

## Read before write

`get_metadata` is the sparse entry point. It returns identity and hierarchy without pixel arrays.

Choose one detailed context:

- Exact pixel or normal work: `get_design_context` with selection, explicit bounds, or content bounds.
- Palette cleanup or color replacement: `get_palette_context`.
- Frame timing, Clip order, or lighting: `get_motion_context`.
- Semantic region discovery and final visual QA: `get_screenshot`.
- Audit or recovery: `get_history`.

## Select with the existing tool

Call `set_selection` when the requested target is known:

- `rect`: exact x, y, width, height.
- `pixels`: non-contiguous coordinate mask.
- `isometric_diamond`: a browser-visible 2:1 tile mask centered at `center_x`, `center_y`; pass `width` and normally use `height = width / 2`.
- `color`: every matching palette index in the target Layer/Frame.
- `connected`: four-way connected component at x, y.
- `outline`: visible boundary pixels.
- `content_bounds`: current content box.
- `clear`: remove selection.

Use `replace` normally. Use `add`, `remove`, or `toggle` only when extending the current selection. The web Canvas displays the same canonical Selection immediately.

For isometric work, first call `control_web { type: "set_view", show_grid: true, grid_mode: "isometric" }`. The guide is a 2:1 projection over the existing square-pixel document, so every selected and painted result remains an exact raster pixel. Use `isometric_diamond` for a top face, then reuse the ordinary pixel, normal, palette, motion, History, and export actions. Do not describe the guide as a voxel model or a tile-map data conversion.

## Apply immediately

Call `use_editable_pixel` with one action and a concise reason. Supported groups:

- Pixels: paint coordinates/selection, erase, replace color, move, flip.
- Normals: paint packed normal values or reset selected normals.
- Palette: add, remove with replacement, replace/merge, reorder.
- Layers: add, remove, duplicate, rename, reorder, visibility, opacity.
- Frames: add, remove, duplicate, rename, reorder, duration, lighting, interpolation. Lighting accepts `shading: "toon-palette"` with `toonSteps: 3..6` for discrete generated pixel-color ramps, or `shading: "smooth"` for continuous RGB lighting.
- Clips: create, remove, rename, reorder Frames, reorder Clips.
- Project: rename.

The server validates and commits immediately, broadcasts the result to the browser, autosaves when the session has a writable file, and records actor=`ai` in shared History. Use `undo` or `redo` for recovery.

Legacy `create_patch`, `preview_patch`, `apply_patch`, and `reject_patch` remain for compatibility or specialized review flows; do not use them as the default workflow.

## Typical sequences

### “Select every use of color 3 and change it to color 5”

1. `get_metadata`
2. `get_palette_context`
3. `set_selection { type: "color", color_index: 3 }`
4. `use_editable_pixel { type: "replace_color", from_color_index: 3, to_color_index: 5, selection_only: true }`

### “Clean the outside white outline”

1. `get_screenshot` when semantic confirmation is needed.
2. `set_selection { type: "outline" }`
3. `get_design_context { padding: 1 }`
4. Paint or erase only verified coordinates with `use_editable_pixel`.

### “Make the light ease between Frame 1 and Frame 4”

1. `get_motion_context`
2. Set lighting on the target keyframes with `use_editable_pixel`.
3. Set the first keyframe interpolation to `ease-in-out`.
4. Call `get_motion_context` and optionally `get_screenshot` for QA.

## Batch first: multiple shades in one call

After focused context gives the current revision and source indices, submit all mappings together. Replace placeholder session/revision/indices with observed values:

```json
{"session_id":"YOUR_SESSION_ID","base_revision":12,"reason":"Recolor selected shades","action":{"type":"remap_colors","selection_only":true,"mappings":[{"id":"dark","from_color_index":3,"to_color":"#123456ff"},{"id":"light","from_color_index":4,"to_color":"#abcdefFF"}]},"response_format":"json"}
```

For an explicitly requested whole-frame edit, replace `selection_only` with `targets:[{"layer_id":"artwork","frame_id":"frame-1"}]`. Targets edit those entire buffers, even if a different selection is active. Never use that mode for a selection-bounded request. A remap uses frozen original pixels; swapping colors and chained mappings do not cascade. Same RGBA reuses the palette. Invalid mappings fail individually, with no unused palette colors allocated for them.

Mix ordinary actions in one request:

```json
{"session_id":"YOUR_SESSION_ID","base_revision":12,"reason":"Timing and name","operations":[{"id":"timing","action":{"type":"set_frame_duration","frame_id":"frame-1","duration_ms":120}},{"id":"label","depends_on":["timing"],"action":{"type":"rename_frame","frame_id":"frame-1","name":"Idle"}}],"response_format":"json"}
```

Results contain `committed`, `revision`, `changedPixels`, and item `results` with IDs, statuses and errors. Remap mapping results live in the operation's `items`. Report partial failures rather than claiming the whole request succeeded. Only successful/noop earlier dependencies unblock an item. Refresh revision and retry failed items only; do not replay all successes. IDs are correlation labels, not exactly-once guarantees. One Undo reverts the whole committed subset; all-failed/noop batches do not add History. Existing single `action` remains accepted. Never reconstruct full document arrays from compact mutation output; request focused context only if needed.
