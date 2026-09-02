# Getting started

Editable Pixel stores complete work in a Pixel Project and uses Pixel Document JSON as the exchange boundary for its one editable canvas. The local browser editor, CLI, and coding-agent session operate on the same active Project context.

## Install

The npm package is not published yet. For the current pre-release, build from this repository:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
node packages/pixel-cli/dist/cli.js --help
```

Node.js 20.9 or newer is required.

In the examples below, replace `editable-pixel` with `node packages/pixel-cli/dist/cli.js` when running from source. The [README](../README.md#run-locally) also documents the prepared npm and install-script workflows for after publication.

## Start the local editor

Open a valid source-less Project immediately:

```bash
editable-pixel open
```

The CLI starts the loopback server and opens a local browser session. No hosted web service receives the Project or source images.

To create a named Project file first:

```bash
editable-pixel project create "Robot Pack" \
  --size 64 \
  --output ./robot-pack.pixel-project.json
```

Then open it in the local editor:

```bash
editable-pixel open ./robot-pack.pixel-project.json
```

The Project menu creates, opens, and reopens recent Projects. There is no manual Save button: meaningful edits autosave as Project revisions. Save As clones the whole Project under a new name and ID.

## Import in the browser

Use the header Import button, paste an image, or drop files onto the editor. Choose one explicit purpose:

- `Replace Canvas`: replace the Project's editable canvas with the imported result.
- `Add as Frames`: normalize ordered images into the active Clip.
- `Import Sprite Sheet`: split one image by columns and rows, left-to-right then top-to-bottom.
- `Add Source`: retain input only for comparison or reconversion.
- `Replace Source`: replace the selected retained input without replacing edited pixels.

The number of files never silently determines ownership. Added Frames and Sprite Sheet tiles are normalized to the Project canvas.

## Convert one image from the CLI

```bash
editable-pixel convert ./robot.png \
  --size 64 \
  --colors 18 \
  --alignment bottom-center \
  --content-scale 0.8 \
  --dithering none \
  --background alpha \
  --output ./robot.pixel.json
```

For a rectangular target or fixed palette:

```bash
editable-pixel convert ./portrait.png \
  --width 24 --height 32 \
  --palette "#00000000,#26314fff,#f4d35eff" \
  --output ./portrait.pixel.json
```

The CLI refuses to overwrite an existing output. Replace a Project canvas without changing the input Project file:

```bash
editable-pixel project import-document \
  ./robot-pack.pixel-project.json ./robot.pixel.json \
  --output ./robot-pack-with-robot.pixel-project.json
```

## Edit and animate

The Inspector has `Convert`, `Edit`, and `Frames` tabs.

- Convert controls canvas normalization, palette, background, dithering, and Content Frame.
- Edit controls Color/Normal/Lit views, palette operations, and Layers.
- Frames controls Clips, onion skin, Frame order, duration, and playback.

The floating toolbar provides Pen, Eraser, Fill, and Select. Canvas, Layers, and Frames maintain distinct keyboard targets, so copy/paste and Delete act on the focused surface. Temporary network loss keeps browser pixel edits visible and queued; reconnect flushes them or exposes a conflict.

## Connect an agent

```bash
# Install the bundled Skill and auto-register its MCP in both hosts
editable-pixel install-skill --host both
```

For Codex's in-app browser:

```bash
editable-pixel --json open ./robot-pack.pixel-project.json --host codex
```

The JSON includes a one-time `launchUrl`. Open it without copying it into chat or logs. The browser exchanges the bootstrap secret for a session token and removes it from the URL. Claude uses `--host claude` to open the same workflow in the system browser.

The agent first reads sparse metadata, then requests only the required Selection or bounds. It may set the canonical Canvas Selection itself and immediately apply a validated `use_editable_pixel` action. For connected-browser state and workflows it reads `get_web_context`, uses `control_web` instead of DOM clicks, imports validated absolute local paths with `import_files`, and triggers the same Export choices with `export_web`. The same Selection overlay, History, Undo, Redo, revision, Project state, and autosave are used by the browser and the agent. Use screenshots for visual understanding or QA, not as a mandatory approval step.

## Validate, render, and export

```bash
editable-pixel validate ./robot-pack.pixel-project.json
editable-pixel render ./robot-pack.pixel-project.json \
  --format color --scale 4 --output ./robot.png
editable-pixel render ./robot-pack.pixel-project.json \
  --format normal --output ./robot-normal.png
editable-pixel render ./robot-pack.pixel-project.json \
  --format lit --output ./robot-lit.png
editable-pixel export ./robot-pack.pixel-project.json \
  --output ./robot-export
```

The web Export popover additionally supports Current Frame, Current Clip, and Entire Project scopes, plus nearest-neighbor scale, GIF animation, and complete Project JSON.

Continue with the [CLI reference](./cli.md), [MCP guide](./mcp.md), [Project model](./project-model.md), and [Pixel Document reference](./pixel-document.md).
