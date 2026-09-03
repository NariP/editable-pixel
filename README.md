# Editable Pixel

[한국어](./README.ko.md) · [Demo video](#demo-video) · [Examples](#before-and-after) · [Run locally](#run-locally) · [Connect your agent](#connect-codex-or-claude)

**Keep the sprite. Change exactly what you mean.**

A local pixel-art workbench for people creating assets with AI. Import a generated image or sprite sheet, convert it to an editable pixel grid, and refine it in the browser—or ask **Codex or Claude** to edit the same canvas through MCP.

Change a character's color scheme without redrawing it. Align animation frames. Edit exact pixels, paint normal maps, and export the result.

## Demo video

https://github.com/user-attachments/assets/cd54beff-7445-4f5a-83be-fcb16d0de2c9

40 seconds of full-palette recoloring, frame alignment, and a Lit PNG showcase. Korean captions with music; play the video above directly on GitHub.

## Before and after

The palette and alignment comparisons use an eight-frame, **128×128** robot demo, displayed at matching integer scales. The lighting showcase uses a separately selected Lit PNG export. The sprites are not regenerated.

### Recolor the character, including its shading

> “Turn the orange robot blue across all eight frames. Keep the shading and cyan accents.”

![Orange robot before and blue robot after: highlights, midtones, and shadows are remapped together](./docs/media/before-after-palette.png)

The demo maps **35 warm palette shades** to corresponding blues—not one flat replacement color. Cyan accent colors, dark visor pixels, the silhouette, and animation poses stay intact.

### Align the animation's ground contact

> “Move the last frame down to match the first frame's ground position.”

![Frame 1 reference at Y121, Frame 8 before at Y108, and Frame 8 after moving down 13 pixels to Y121](./docs/media/before-after-ground.png)

A deliberately offset demo frame is moved **13 pixels**. Its pose is preserved; only its position changes. Ground alignment is one part of loop cleanup, not a claim that different poses become identical.

### Add lighting without repainting the color layer

> “Use a prepared normal map with Smooth lighting, then export a Lit PNG.”

![Actual 128×128 robot Lit PNG export shown at 4×](./docs/media/before-after-lighting.png)

The showcase displays the selected [Lit PNG](./docs/media/evaluation-fixture-lit.png) unchanged. Use **Smooth lighting** with a prepared normal map for continuous shading rather than Toon Palette steps. Color, Normal, and Lit are separate exports; importing an image alone does not automatically create its normal map. This is an output showcase; the original map and light settings are not included in the supplied PNG.

[Demo details and verification](./docs/media/README.md)

## One editor, shared with your agent

![Editable Pixel browser editor after an AI palette edit](./docs/media/editor-palette-ai.png)

- **Visible selections.** AI-selected regions use the same Selection tool as your mouse.
- **Shared History.** AI and manual edits share Undo, Redo, revision checks, and autosave.
- **Pixel-level control.** Target coordinates, rectangles, masks, connected regions, palette colors, Layers, Frames, or Clips.
- **Direct MCP editing.** Inspect focused context and apply structured edits without simulating mouse clicks for every pixel.

Example requests:

```text
Move the selected pixels 2 px to the right.
Remove stray white pixels outside the outline; leave the interior alone.
Replace the robot's orange palette ramp with blue across this animation.
Set Frame 1 to 160 ms and Frame 4 to 100 ms.
```

## Run locally

Requires **Node.js 20.9+**. This starts a local editor, not a hosted web service.

```bash
npm install --global editable-pixel
editable-pixel open
```

**Windows:** use the source build below until the next npm release; the Windows launcher fixes are not in `1.0.1`. Use PowerShell or Command Prompt, not `install.sh`. If PowerShell blocks npm's `.ps1` launcher, run `npm.cmd` / `editable-pixel.cmd` instead; changing your execution policy is not required.

Use an npm installation directory without `&`; npm's Windows `.cmd` wrapper cannot launch from that path. See [Windows setup and test coverage](./docs/mcp.md#windows).

<details>
<summary>Build from source (requires pnpm 10.29.3)</summary>

```bash
git clone https://github.com/NariP/editable-pixel.git
cd editable-pixel
corepack enable
pnpm install --frozen-lockfile
pnpm build
node packages/pixel-cli/dist/cli.js open
```

The editor runs on `127.0.0.1`. Start with a blank Project, or open an existing file:

```bash
node packages/pixel-cli/dist/cli.js open character.pixel-project.json
node packages/pixel-cli/dist/cli.js open character.pixel.json
```

</details>

<details>
<summary>Install script, update, or remove</summary>

Alternatively, on macOS or Linux, review [install.sh](./install.sh) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/NariP/editable-pixel/main/install.sh | sh
```

The script installs the published npm package. Running it again updates the installation; `sh install.sh --version X.Y.Z` selects a release.

```bash
npm update --global editable-pixel
npm uninstall --global editable-pixel
```

Uninstalling the package does not delete exported files or browser-local Projects.

</details>

## Connect Codex or Claude

With the npm installation:

```bash
editable-pixel install-skill --host both
```

Use `--host codex` or `--host claude` to register only one host. This installs the bundled **Skill** and registers the local **MCP server**. Restart the host or reload its MCP connections, then ask it to open and edit your Project. From a source build, use `node packages/pixel-cli/dist/cli.js install-skill --host both` instead and keep that repository at its installed path: the registration points to the built executable there.

The Skill guides the agent to read metadata first, inspect only the relevant region, and apply edits to the same Project you see. See [host setup and MCP tools](./docs/mcp.md).

Editable Pixel's editor, conversion, and rendering run locally. Context supplied to Codex or Claude is handled under that host's own model and privacy settings; a local editor does not make a cloud AI host offline.

## Import → edit → export

1. **Import** PNG, WebP, JPEG, Pixel JSON, a Project, a frame sequence, or a sprite sheet. Choose whether to replace the canvas, add Frames, or retain a Source.
2. **Convert** retained images to a logical pixel grid with canvas size, palette, background, alignment, and dithering controls.
3. **Edit** pixels and Layers; organize Frames into Clips; tune frame duration, playback, and Onion Skin. Use Color/Normal editing and Smooth or Toon Palette lighting as needed.
4. **Export** Color PNG, Normal PNG, baked Lit PNG, GIF, Sprite Sheet, editable Pixel JSON, or the complete Project. Integer export scales preserve crisp pixels.

## Isometric guides

Switch the canvas toolbar to **2:1 isometric grid** for a 2:1 guide. Select diamond-shaped tiles through the CLI or Codex/Claude MCP, then reuse the normal pixel, palette, lighting, and export tools.

```bash
editable-pixel view set --session <session-id> --grid-mode isometric
editable-pixel selection diamond --session <session-id> --center-x 32 --center-y 32 --width 32
```

The default tile height is half its width. Selections appear in the existing Selection tool and share Undo/Redo. The view command needs that session open in a connected browser. From a source checkout, replace `editable-pixel` with `node packages/pixel-cli/dist/cli.js`.

This is a guide over square raster pixels, not a voxel model, automatic perspective conversion, or tile-map format. See the [CLI reference](./docs/cli.md#isometric-grid-and-selection) for visibility, target, and selection-combination options.

## What gets saved?

| Format | Purpose |
| --- | --- |
| `.pixel-project.json` | Complete Project: one editable canvas, Layers, Frames, Clips, and optional retained Sources. |
| `.pixel.json` | Editable Pixel Document with palette, pixels, frame timing, normal maps, and lighting. |
| PNG / GIF / Sprite Sheet | Derived outputs for games, previews, and other tools. |

Edits autosave in the local workspace. **Save As** creates an independent Project, not another V1/V2 variant. Export a Project file when you need a portable backup.

A retained image Source is optional for drawing and editing. Keep one if you need source-based reconversion or Content Frame normalization; a Pixel JSON alone is not the original image. See the [Project model](./docs/project-model.md).

Editable Pixel does **not** include an image-generation model or sprite-sheet generator. Bring output from your preferred generator; use this tool for conversion, precise corrections, animation cleanup, and export.

## Documentation and development

- [Getting started](./docs/getting-started.md)
- [CLI reference](./docs/cli.md) · [MCP and host integration](./docs/mcp.md)
- [Project model](./docs/project-model.md) · [Pixel Document format](./docs/pixel-document.md)
- [Security model](./docs/security.md) · [Report a vulnerability](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md) · [Release process](./docs/releases.md) · [Validation record](./docs/validation.md)

```bash
pnpm dev                  # Web development server
pnpm verify               # Build, lint, typecheck, unit/integration tests
pnpm test:e2e             # Browser workflows
pnpm test:distribution    # Packaged installation checks
pnpm test:source-install  # Clean source-checkout installation
```

## License

[MIT](./LICENSE)
