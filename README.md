# Editable Pixel

[한국어](./README.ko.md)

Editable Pixel turns AI-generated pixel-style images into deterministic, editable pixel assets. It combines a raster-to-pixel converter, a focused Canvas editor, a local session server, a CLI, and an MCP server so you can select part of an image and edit only that region with Codex or Claude.

> Release status: the source implementation and installable package are available in this repository. The public npm package and GitHub release have not been published yet.

## Why it exists

AI image generators often produce raster images that only look like pixel art: logical pixel sizes vary, edges contain anti-aliasing, palettes drift between assets, and regenerating one detail changes unrelated pixels. Editable Pixel converts that output into a versioned `.pixel.json` document with a real grid, palette, layers, frames, content bounds, and pivot.

It is built for AI-generated game characters, items, icons, tiles, and sprites. It is not intended to replace a general-purpose editor such as Aseprite.

## What you can do

- Convert PNG, WebP, and JPEG inputs to 16–128 px logical canvases or a custom size.
- Remove a solid background, use source alpha, or plug in a local background-removal adapter.
- Normalize a single image or a batch to a shared canvas, content box, alignment, pivot, and palette.
- Reduce colors with an automatic or fixed palette and optional Floyd–Steinberg dithering.
- Compare the source and converted asset in a focused browser editor.
- Keep the original image in the current tab, change normalization settings, and reconvert without uploading it again.
- Preserve edited results as variants, restore the current tab after refresh, and use Tight/Safe/Custom Content Frames for consistent transparent padding.
- Draw, erase, fill, replace colors, and edit selections, palettes, layers, and frames.
- Select a rectangle in the browser and expose that exact selection to Codex or Claude.
- Preview, apply, reject, undo, and redo agent-created patches without changing pixels outside the selection.
- Export readable or compact Pixel Document JSON, logical PNG, scaled preview, layer/frame PNGs, and sprite sheets.

## How it works

```text
PNG / WebP / JPEG
        ↓
Converter → sprite.pixel.json ← Core operations
                         ↕
Codex / Claude ↔ CLI / MCP ↔ local session server ↔ web editor
                         ↓
          PNG / preview / layers / frames / sprite sheet
```

`.pixel.json` is the editable source of truth. Canvas displays and edits the document; PNG files are derived exports. All image processing stays on the local machine, and the session server binds to `127.0.0.1` by default.

## Installation

The release workflow publishes one npm package containing the CLI, converter, renderer, local server, built web editor, and MCP executable:

```bash
npm install --global editable-pixel
```

Until the first public release is published, build from this repository:

```bash
corepack enable
pnpm install
pnpm build
node packages/pixel-cli/dist/cli.js --help
```

Requirements: Node.js 20.9 or newer.

## Quick start

Convert an AI-generated image:

```bash
editable-pixel convert hero.png \
  --size 32 \
  --colors 16 \
  --alignment bottom-center \
  --output hero.pixel.json
```

Custom rectangular targets and fixed palettes are available with `--width`, `--height`, and `--palette`.

Open the document in a local browser session:

```bash
editable-pixel open hero.pixel.json
```

Inside the editor, choose the Select icon (`S`) from the floating toolbar and drag a rectangle. The coordinates are synchronized immediately, but selecting never runs an edit by itself. The Canvas stays visible while the right Inspector switches between `CONVERT`, `EDIT`, and `AGENT`; at Codex-width viewports the Inspector opens as a sheet.

Validate and export:

```bash
editable-pixel validate hero.pixel.json
editable-pixel render hero.pixel.json --scale 8 --output hero@8x.png
editable-pixel export hero.pixel.json --output hero-export
```

Add `--json` to any command when an agent or script needs stable machine-readable output.

## Codex and Claude

Install the local MCP server after installing the npm package:

```bash
# Codex
codex mcp add editable-pixel -- editable-pixel-mcp

# Claude Code, project scope
claude mcp add --scope project editable-pixel -- editable-pixel-mcp
```

For Codex, use `editable-pixel open hero.pixel.json --host codex --json`. The command returns a one-time loopback URL that Codex can open in its in-app browser. For Claude Code, `--host claude` opens the same local editor in the system browser. Both hosts read the same selection and document revision through the local session.

A safe conversational edit follows this sequence:

1. Read the active session and browser selection.
2. Create a patch bounded to that selection and current revision.
3. Send a before/after preview to the editor.
4. Apply only after the user asks to make the change, or reject it.
5. Revalidate the document and observe the updated browser state.

The optional host skill in [`skills/editable-pixel`](./skills/editable-pixel) documents this workflow for coding agents. See [MCP setup](./docs/mcp.md) for tool details and host-specific behavior.

## Packages

| Package | Responsibility |
| --- | --- |
| `pixel-document` | Versioned schema, parser, validation, migration, serialization |
| `pixel-core` | Deterministic edits, bounded patches, revision checks, undo/redo |
| `pixel-converter` | Raster decoding, footprint normalization, palette quantization |
| `pixel-renderer` | Canvas buffers, deterministic PNGs, layers, frames, sprite sheets |
| `pixel-server` | Loopback HTTP/WebSocket sessions, tokens, file safety, conflict detection |
| `pixel-cli` | Human and machine command interface; distributable npm package |
| `pixel-mcp` | Structured local tools for Codex and Claude |
| `apps/web` | Conversion, comparison, editing, selection, patch review, export |

The packages directory is the internal source workspace. Users install the single `editable-pixel` package; they do not need to install workspace packages individually.

## Documentation

- [Getting started](./docs/getting-started.md)
- [Pixel Document v1](./docs/pixel-document.md)
- [CLI reference](./docs/cli.md)
- [MCP and host integration](./docs/mcp.md)
- [Security model](./docs/security.md)
- [Release process](./docs/releases.md)
- [Validation record](./docs/validation.md)
- [Contributing](./CONTRIBUTING.md)

## Development

```bash
pnpm install
pnpm verify
pnpm test:e2e
```

`pnpm verify` builds every package, lints, type-checks, and runs unit and integration tests. Browser E2E and clean-package installation tests are separate so their runtime dependencies are explicit.

## License

[MIT](./LICENSE)
