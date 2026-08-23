# Getting started

Editable Pixel converts AI-generated raster images into Pixel Documents and lets a browser editor and coding agent share one local editing session.

## Install

After a tagged release is published:

```bash
npm install --global editable-pixel
editable-pixel --version
```

To run the current source checkout:

```bash
corepack enable
pnpm install
pnpm build
node packages/pixel-cli/dist/cli.js --help
```

Node.js 20.9 or newer is required.

## Convert one image

```bash
editable-pixel convert ./hero.png \
  --size 32 \
  --colors 16 \
  --alignment bottom-center \
  --content-scale 0.8 \
  --dithering none \
  --background alpha \
  --output ./hero.pixel.json
```

The output is refused if the destination already exists. This prevents an accidental overwrite; choose a new path or explicitly remove the old generated output.

For a non-square target or a palette shared with an existing asset set:

```bash
editable-pixel convert ./portrait.png \
  --width 24 --height 32 \
  --palette "#00000000,#26314fff,#f4d35eff" \
  --output ./portrait.pixel.json
```

`--width` and `--height` override the square `--size` default. A fixed palette takes precedence over `--colors`.

For an opaque single-color background, use `--background solid`. The converter uses the image's corner color as the background reference. `local-removal` requires an explicitly configured local adapter in the library API and fails clearly when none is available.

## Normalize a batch

```bash
editable-pixel convert ./walk-1.png ./walk-2.webp ./walk-3.jpg \
  --size 64 \
  --colors 24 \
  --alignment bottom-center \
  --output ./normalized
```

All inputs share the generated palette, canvas, content box, and pivot. Each result is written as `<input-name>.pixel.json`.

## Open the editor

```bash
editable-pixel open ./hero.pixel.json
```

The command starts or reuses the loopback session server and opens the browser. The editor shows the document revision, connection state, logical canvas, active layer/frame, and selection.

To make a conversational edit:

1. Click `[ SELECT AREA ]`.
2. Drag a rectangle over the exact pixels the agent may change.
3. Ask Codex or Claude for the change.
4. Review the before/after patch in the right-hand panel.
5. Apply or reject it.

Selection coordinates synchronize automatically. No edit starts merely because a selection changed.

## Connect an agent

```bash
# Codex
codex mcp add editable-pixel -- editable-pixel-mcp

# Claude Code
claude mcp add --scope project editable-pixel -- editable-pixel-mcp
```

For Codex's in-app browser, create a session with:

```bash
editable-pixel --json open ./hero.pixel.json --host codex
```

The JSON includes a one-time `launchUrl`. Open it in the Codex browser without copying it into chat or logs. The browser removes the bootstrap secret after exchanging it for a session token. If no in-app browser is available, use the normal `browser` host.

For Claude Code, use `--host claude`; the editor opens in the system browser while Claude communicates with the same session through MCP.

## Validate, render, and export

```bash
editable-pixel validate ./hero.pixel.json
editable-pixel render ./hero.pixel.json --output ./hero.png
editable-pixel render ./hero.pixel.json --scale 8 --output ./hero@8x.png
editable-pixel export ./hero.pixel.json --output ./hero-export
```

The export directory contains the canonical document copy, logical and enlarged PNGs, layer and frame images, and a sprite sheet with JSON metadata.

Continue with the [CLI reference](./cli.md), [MCP guide](./mcp.md), and [Pixel Document reference](./pixel-document.md).
