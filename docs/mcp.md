# MCP and coding-agent integration

`editable-pixel-mcp` is a local stdio MCP server. It connects Codex or Claude to the same protected loopback Session Server used by the web editor. The browser, MCP, CLI, Project autosave, Selection, revision, History, Undo, and Redo all operate on one canonical session.

## Install the package, Skill, and MCP

```bash
npm install -g editable-pixel

# Install the bundled Skill and register its absolute MCP entrypoint
# at user scope in both hosts.
editable-pixel install-skill --host both
```

Verify the real host configuration with `codex mcp get editable-pixel` and `claude mcp get editable-pixel`. Use `--no-register-mcp` only for externally managed host configuration.

### Windows

Use `editable-pixel` version `1.0.2` or later. Install or update with `npm install -g editable-pixel@latest`, then run `editable-pixel install-skill --host both`. A source build also works: run `node packages/pixel-cli/dist/cli.js install-skill --host both` from the built checkout.

The host CLIs must be on `PATH`. Registration handles npm's `codex.cmd` / `claude.cmd` wrappers as well as native executables, and stores the absolute Node executable and MCP JavaScript entrypoint as separate arguments. Paths containing spaces are supported. Skills go to `.codex/skills` or `.claude/skills` in your user profile.

In PowerShell, use `npm.cmd`, `pnpm.cmd`, or `editable-pixel.cmd` if script execution policy blocks the corresponding `.ps1` wrapper. No execution-policy change is necessary. `install.sh` is macOS/Linux-only.

Avoid `&` in Windows npm installation directories, including those of the host CLIs. npm's generated `.cmd` wrapper assigns its directory without quoting and fails before the application starts. This is an upstream launcher limitation, not a Pixel Document restriction; use an installation directory without `&`.

Windows x64 and Linux CI run the full verification, Chromium editor E2E, packaged install/update/remove, conversion/rendering, MCP stdio handshake/tool call, and clean source-install checks. Automatic registration is tested with isolated fixture host CLIs (real npm `.cmd` shims on Windows), not authenticated Codex/Claude accounts. The checks do not verify the host applications' GUI, system default-browser launching, or Windows ARM64.

Open a Project or Pixel Document:

```bash
editable-pixel --json open ./robot-pack.pixel-project.json --host codex
# or
editable-pixel open ./robot-pack.pixel-project.json --host claude
```

Codex can open the returned one-time URL in its in-app browser. Claude uses the system browser. The URL token is exchanged for a session token and removed from browser history.

## Figma-inspired context flow

The default flow keeps large pixel arrays out of the initial prompt:

```text
list_sessions (only when needed)
  → get_metadata
      → get_design_context | get_palette_context | get_motion_context
          → optional get_screenshot
              → set_selection when target differs
                  → use_editable_pixel
                      → get_history | undo | redo
```

When a request depends on the connected web app rather than document pixels, branch from metadata to `get_web_context`, then use one semantic `control_web`, `import_files`, or `export_web` call. Do not reproduce those operations with screenshot-coordinate clicks.

`get_metadata` returns IDs, names, hierarchy, canvas, counts, active context, selection, and revision. It never returns frame pixel arrays. `get_design_context` returns only the active selection, explicit bounds, or content bounds plus 0–8 pixels of padding and is capped at 65,536 pixels.

## Primary tools

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `list_sessions` | No | Find active local sessions |
| `get_metadata` | No | Sparse Project/Clip/Frame/Layer/canvas discovery |
| `get_design_context` | No | Focused palette-index matrix and optional normals |
| `get_palette_context` | No | Palette indices, RGBA values, transparency, and exact usage |
| `get_motion_context` | No | Clip order, durations, lighting keyframes, easing, resolved lights |
| `get_history` | No | User and AI actions in shared Undo/Redo order |
| `get_screenshot` | No | Optional visual understanding or post-edit QA |
| `get_web_context` | No | Connected tab, tool, Project, Source, conversion, playback, and capability state |
| `set_selection` | Yes | Update the same Selection rendered by the web Canvas |
| `use_editable_pixel` | Yes | Immediately apply one validated AI edit transaction |
| `control_web` | Yes | Semantic tab/view/target/playback/conversion/Project/Source operations |
| `import_files` | Yes | Import validated local PNG, WebP, JPEG, Pixel JSON, or Project JSON into the browser workflow |
| `export_web` | Browser download | Trigger the header Export formats, scopes, and integer scales |
| `undo` / `redo` | Yes | Restore the shared session History |
| `validate_document` | No | Validate supplied Pixel Document JSON |
| `export_frame` | Output file | Export Color, Normal, or Lit PNG without overwriting |

Compatibility tools `get_session`, `get_project_context`, `get_document_summary`, `get_selection`, `get_selection_context`, `create_patch`, `preview_patch`, `apply_patch`, `reject_patch`, and `render_preview` remain available. Preview approval is not part of the default Skill workflow.

## Shared Selection

`set_selection` supports:

- `rect`: an exact rectangle
- `pixels`: a non-contiguous coordinate mask
- `isometric_diamond`: a 2:1 top-face mask centered on exact canvas coordinates
- `color`: every use of one palette index in the target Layer/Frame
- `connected`: a four-way connected component
- `outline`: visible boundary pixels
- `content_bounds`: current content bounds
- `clear`: remove the Selection

The modes `replace`, `add`, `remove`, and `toggle` match the web Selection behavior. Selection changes are document transactions, appear immediately through WebSocket, and participate in Undo/Redo.

The connected editor can switch between square and 2:1 isometric guides through `control_web.set_view`. Isometric mode is a projection guide over the same square-pixel document, so existing Color, Normal, Frame, History, and export actions remain unchanged.

## Immediate editing

`use_editable_pixel` accepts a strict discriminated action union:

- Pixel: paint coordinates or Selection, erase, replace color, move, flip
- Normal: paint packed normals, reset selected normals
- Palette: add, remove with replacement, replace/merge, reorder
- Layer: add, remove, duplicate, rename, reorder, visibility, opacity
- Frame: add, remove, duplicate, rename, reorder, duration
- Lighting: set keyframe position/height/intensity/ambient, choose Smooth or `toon-palette` shading with 3–6 ramp steps, set Hold/Linear/Ease interpolation, remove keyframe
- Clip: create, remove, rename, reorder Frames, reorder Clips
- Project: rename

Each action requires a concise `reason`. The server validates the action, current target, Selection, palette, schema, and revision; applies one transaction; records actor=`ai`; persists writable files; and broadcasts the resulting document to the browser. Use `undo` instead of an approval gate when a result should be reverted.

## Import, Convert, and Export boundary

MCP owns live context, editing, and the browser's semantic file workflows. `import_files` accepts only absolute regular files, rejects symlinks and unsupported formats, and applies per-file/batch size limits before transmitting bytes to the connected loopback browser. It is not an arbitrary filesystem or shell interface:

- Convert image files: `editable-pixel convert`
- Import into Project or add Source/Frames/Sprite Sheet: `import_files`
- Validate or render a file: `editable-pixel validate`, `editable-pixel render`
- Trigger the browser's Project/Clip/Frame downloads: `export_web`
- Export a full server-side bundle to a concrete directory: `editable-pixel export`
- Export the active Color/Normal/Lit Frame into the session output directory: `export_frame`

Existing outputs are never replaced.

## Error recovery

- `SELECTION_REQUIRED`: call `set_selection` or use an action that does not require a Selection.
- `DESIGN_CONTEXT_TOO_LARGE`: select a smaller region or pass explicit bounds.
- `FILE_CONFLICT`: reopen or refresh the session; never use last-write-wins.
- `OUTPUT_EXISTS`: choose a new filename.
- `SERVER_NOT_RUNNING`: run `editable-pixel open <file>`.

All tools return structured content and actionable error codes. The server exposes neither shell execution nor arbitrary path writes.
