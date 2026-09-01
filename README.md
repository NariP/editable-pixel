# Editable Pixel

[한국어](./README.ko.md)

**Turn AI-generated pixel-style images into deterministic, editable pixel assets — locally.**

Editable Pixel is a local-first pixel workbench for images, short animations, Normal Maps, and selection-bounded Codex or Claude edits. The CLI starts a loopback server and opens the editor in your browser; your source images, Projects, and editing sessions stay on your machine.

![Editable Pixel local editor](./docs/media/editor-overview.png)

![64×64 robot motion preview](./docs/media/robot-motion-64.gif)

## Install

### Install script (macOS and Linux)

Review [install.sh](./install.sh), then run:

```bash
curl -fsSL https://raw.githubusercontent.com/NariP/editable-pixel/main/install.sh | sh
```

### npm

```bash
npm install --global editable-pixel
```

Node.js 20.9 or newer is required. No hosted Editable Pixel service is involved.

## Start the local editor

Open a blank source-less Project:

```bash
editable-pixel open
```

Or open an existing Project or Pixel Document:

```bash
editable-pixel open character.pixel-project.json
editable-pixel open character.pixel.json
```

The command starts a server bound to `127.0.0.1` and opens a one-time local browser session. You can immediately Import a PNG, WebP, JPEG, Pixel JSON, Pixel Project, frame sequence, or Sprite Sheet from the header.

You can also try the latest published package without installing it globally:

```bash
npx editable-pixel open
```

## Connect Codex and Claude

The npm package includes the Editable Pixel Skill and MCP executable. Register both after installation:

```bash
editable-pixel install-skill --host both
```

Or install one host at a time:

```bash
editable-pixel install-skill --host codex
editable-pixel install-skill --host claude
```

`install-skill` copies the bundled Skill and registers the absolute local MCP entrypoint. Codex and Claude can then inspect the active Project, show their target through the same Selection tool, and apply pixel, palette, Layer, Frame, Clip, Normal Map, and lighting edits directly to the browser's History. User and AI actions share Undo, Redo, revision checks, and autosave.

See [MCP and host setup](./docs/mcp.md) for the complete protocol.

## Typical workflow

```text
AI image or Sprite Gen output
          ↓
Import into one local Project
          ↓
Convert to a logical pixel grid
          ↓
Edit pixels, Frames, Clips, Normal Maps, and lighting
          ↓
Refine exact regions with Codex or Claude
          ↓
Export PNG, Lit PNG, GIF, Sprite Sheet, or editable JSON
```

Editable Pixel completes and corrects generated assets; it does not bundle an AI Sprite Sheet generator. A generator such as `sprite-gen` can create source frames, while Editable Pixel owns deterministic conversion, exact pixel cleanup, loop refinement, Normal Maps, lighting, and export.

## What you can edit

- Draw, erase, fill, select, cut, copy, paste, and replace palette colors.
- Keep one editable canvas per Project, with optional retained Sources for comparison and reconversion.
- Manage Layers, Frames, named Clips, per-frame duration, playback, and Onion Skin.
- Align imported frame sequences on a shared logical canvas and refine animation loop seams.
- Edit Color and Normal maps per Layer and Frame.
- Preview Smooth or Toon Palette lighting and export baked Lit PNGs.
- Queue edits during a temporary local reconnect and flush them in order afterward.
- Export Color PNG, Normal PNG, Lit PNG, GIF, Sprite Sheet, Pixel JSON, or the complete Project.

## Project model

```text
Pixel Project (.pixel-project.json)
├── Sources (optional retained inputs)
├── Pixel Document (.pixel.json exchange boundary)
│   ├── Canvas + Palette
│   ├── Layers × Frames: Color + Normal pixels
│   └── Frames: duration + lighting
└── Clips: ordered Frame IDs
```

The Project is the autosaved local work unit. `.pixel.json` exchanges its editable canvas. PNG, GIF, and Sprite Sheets are derived outputs. Save As creates an independent Project, not a V2 or Variant.

## Useful CLI commands

Convert an AI image to a 64×64 Pixel Document:

```bash
editable-pixel convert robot.png --size 64 --colors 18 --output robot.pixel.json
```

Create a Project and open it:

```bash
editable-pixel project create "Robot Pack" --size 64 --output robot.pixel-project.json
editable-pixel open robot.pixel-project.json
```

Validate, render, and export:

```bash
editable-pixel validate robot.pixel-project.json
editable-pixel render robot.pixel-project.json --format lit --scale 4 --output robot-lit.png
editable-pixel export robot.pixel-project.json --output robot-export
```

See the [CLI reference](./docs/cli.md) for every command and stable JSON output.

## Update or remove

Running the installer again updates to the latest npm release:

```bash
curl -fsSL https://raw.githubusercontent.com/NariP/editable-pixel/main/install.sh | sh
```

Install a specific version or uninstall:

```bash
sh install.sh --version 1.0.0
sh install.sh --uninstall
```

The equivalent npm commands are:

```bash
npm update --global editable-pixel
npm uninstall --global editable-pixel
```

Removing the npm package does not delete exported files or browser-local Projects.

## Build from source

```bash
git clone https://github.com/NariP/editable-pixel.git
cd editable-pixel
corepack enable
pnpm install --frozen-lockfile
pnpm build
node packages/pixel-cli/dist/cli.js open
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [Project model](./docs/project-model.md)
- [Pixel Document v1](./docs/pixel-document.md)
- [CLI reference](./docs/cli.md)
- [MCP and host integration](./docs/mcp.md)
- [Security model](./docs/security.md)
- [Release process](./docs/releases.md)
- [Validation record](./docs/validation.md)
- [Contributing](./CONTRIBUTING.md)

## Development

```bash
pnpm verify
pnpm test:e2e
pnpm test:distribution
pnpm test:source-install
```

## License

[MIT](./LICENSE)
