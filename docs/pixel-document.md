# Pixel Document v1

Pixel Document is the editable source format used by the converter, web editor, CLI, MCP server, and renderer. A document is stored as JSON, normally with the `.pixel.json` suffix.

## Top-level shape

| Field | Meaning |
| --- | --- |
| `format` | Always `pixel-document` |
| `version` | Current schema version, `1` |
| `id` | Stable document identifier derived from initial content unless supplied |
| `revision` | Monotonic edit revision used for stale-patch rejection |
| `metadata` | Creator/modifier identity plus optional source digest and conversion options |
| `canvas` | Logical width and height, each from 1 to 4096 |
| `palette` | One to 256 `#rrggbbaa` colors |
| `transparentColorIndex` | Palette index used for empty pixels |
| `frames` | Ordered frame IDs, names, and durations |
| `layers` | Ordered visible/opacity state and frame-indexed pixel arrays |
| `contentBox` | Intended normalized footprint rectangle |
| `contentBounds` | Actual non-transparent pixel rectangle |
| `alignment` | `center` or `bottom-center` |
| `pivot` | Canvas-space anchor coordinate |
| `regions` | Named rectangles tied to a layer and frame |
| `selection` | Optional current browser rectangle tied to a layer and frame |

Each `layers[n].frames[frameId]` value is a row-major array of palette indices. Its length must equal `canvas.width * canvas.height`; index `y * width + x` addresses logical pixel `(x, y)`.

## Minimal example

```json
{
  "alignment": "center",
  "canvas": { "height": 2, "width": 2 },
  "contentBounds": { "height": 1, "width": 1, "x": 1, "y": 0 },
  "contentBox": { "height": 2, "width": 2, "x": 0, "y": 0 },
  "format": "pixel-document",
  "frames": [{ "durationMs": 100, "id": "frame-1", "name": "Frame 1" }],
  "id": "px-example",
  "layers": [{
    "blendMode": "normal",
    "frames": { "frame-1": [0, 1, 0, 0] },
    "id": "artwork",
    "name": "Artwork",
    "opacity": 1,
    "visible": true
  }],
  "metadata": { "createdBy": "editable-pixel", "modifiedBy": "editable-pixel" },
  "palette": ["#00000000", "#ff004dff"],
  "pivot": { "x": 1, "y": 1 },
  "regions": [],
  "revision": 0,
  "transparentColorIndex": 0,
  "version": 1
}
```

Serialization sorts object keys recursively, which gives readable and compact output the same meaning and makes repeated serialization deterministic. Array order remains meaningful for palettes, frames, layers, and pixels.

## Validation invariants

- Format and version must be recognized. A future version is rejected instead of being guessed.
- Layer and frame IDs are unique.
- Every layer contains exactly one correctly sized pixel array for every frame and no unknown frame reference.
- Every pixel and `transparentColorIndex` references the palette.
- Content rectangles, regions, selection, and pivot stay inside the canvas.
- Regions and selection reference existing layer and frame IDs.
- Additional unknown properties are rejected by the runtime schema.

## Migration

The parser migrates legacy version 0 documents with top-level `width`, `height`, `palette`, and `pixels` into version 1 with one `artwork` layer and one `frame-1` frame. Unsupported future versions fail validation with a version error. Migrations never silently discard a supported document's pixel data.

## Patches and revisions

A pixel patch identifies the document, base revision, layer, frame, before/after indices, affected bounds, selection, outside-selection hash, reason, creation time, and patch ID. Previewing does not mutate the document. Applying requires the current revision and before-values to match, validates the selection boundary and outside hash, then increments `revision`.

Undo and redo use the same patch representation. There is no automatic merge for stale patches.

The runtime schema and semantic validation live in `packages/pixel-document`; all other packages consume that implementation.
