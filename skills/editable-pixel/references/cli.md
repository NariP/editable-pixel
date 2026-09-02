# CLI reference

Every command supports global `--json` before the subcommand. Failures return a non-zero status and a stable `{ "error": { "code", "message" } }` object on stderr.

```text
editable-pixel install-skill [--host codex|claude|both] [--target DIR] [--force] [--no-register-mcp]
editable-pixel convert <input...> [--size N] [--width N] [--height N] [--colors N] [--palette COLORS] [--alignment center|bottom-center] [--content-scale N] [--dithering none|floyd-steinberg] [--background alpha|solid|local-removal] [--output PATH]
editable-pixel open <document> [--host browser|codex|claude] [--output-directory DIR]
editable-pixel validate <document>
editable-pixel render <document> [--output PNG] [--scale N] [--frame ID] [--layer ID]
editable-pixel export <document> --output DIR
editable-pixel session list
editable-pixel session get <session-id>
editable-pixel session close <session-id>
editable-pixel selection get --session <session-id>
editable-pixel view set --session <session-id> [--grid-mode square|isometric] [--grid show|hide]
editable-pixel selection diamond --session <session-id> --center-x X --center-y Y --width W [--height H] [--layer ID] [--frame ID] [--mode replace|add|remove|toggle]
editable-pixel patch preview --session <session-id> --patch <file>
editable-pixel patch apply --session <session-id> --patch <file-or-id>
editable-pixel patch reject --session <session-id> --patch <patch-id>
editable-pixel undo --session <session-id>
editable-pixel redo --session <session-id>
```

The MCP Skill normally uses immediate `set_selection` and `use_editable_pixel` calls. The `patch preview/apply/reject` CLI commands are retained for compatibility and explicit review workflows.

`view set` requires a connected browser and at least one grid option. Grid mode changes show the grid unless `--grid hide` is also supplied. `selection diamond` uses the same server-side raster mask as MCP `isometric_diamond`, defaults to a half-width height (rounded, minimum 1), clips to the canvas, and rejects empty or over-100,000-pixel results. It targets the active Layer/Frame unless IDs are supplied and shares browser Selection, History, and Undo/Redo. It does not repaint pixels or create voxel/tile-map data.

Conversion and export refuse existing output files. Choose a fresh file or directory; do not delete or overwrite an existing target unless the user explicitly requests that separate action.

Use `--width` and `--height` for a custom rectangular canvas. `--palette` accepts comma-separated `#RRGGBB` or `#RRGGBBAA` colors and takes precedence over automatic `--colors` quantization.
