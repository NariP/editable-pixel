# CLI reference

`editable-pixel` accepts either a complete Pixel Project (`.pixel-project.json`) or its single-canvas Pixel Document (`.pixel.json`) where stated. It prints concise text by default and stable JSON with the global `--json` flag. Failures use a non-zero exit code and emit a structured error on stderr.

The CLI never overwrites an existing output.

## Install the coding-agent Skill

```text
editable-pixel install-skill
  [--host codex|claude|both]
  [--target <managed-skill-root>]
  [--force]
  [--no-register-mcp]
```

The npm package bundles the same `editable-pixel` Skill used by this repository. The default destination is `~/.codex/skills/editable-pixel`, `~/.claude/skills/editable-pixel`, or both. It also registers the packaged MCP entrypoint by absolute path at user scope in each selected host. Existing Skill directories and MCP registrations are not replaced unless `--force` is explicit. `--target` is intended for managed environments and installation tests and does not mutate host MCP configuration. Use `--no-register-mcp` only when host registration is intentionally managed elsewhere.

## Project commands

```text
editable-pixel project create <name>
  [--output <project.pixel-project.json>]
  [--size <pixels>]

editable-pixel project import-document <project> <document>
  [--output <new-project.pixel-project.json>]

editable-pixel project export-document <project>
  [--output <document.pixel.json>]
```

`create` produces a valid source-less Project. `import-document` replaces the Project canvas in a new output file and leaves the input Project unchanged. `export-document` writes the Project canvas as editable Pixel JSON.

## Convert

```text
editable-pixel convert <input...>
  [--size <1..4096>]
  [--width <1..4096>]
  [--height <1..4096>]
  [--colors <1..256>]
  [--palette <#RRGGBB-or-#RRGGBBAA,...>]
  [--alignment center|bottom-center]
  [--content-scale <0..1>]
  [--dithering none|floyd-steinberg]
  [--background alpha|solid|local-removal]
  [--output <file-or-directory>]
```

`--width` and `--height` override the square size. A fixed palette takes precedence over `--colors`. Multiple inputs share the normalization target and generated palette. Every destination is checked before a batch writes anything.

## Open

```text
editable-pixel open [project-or-document]
  [--output-directory <path>]
  [--host browser|codex|claude]
  [--no-browser]
```

Without an input, `open` creates a source-less blank canvas. With a Project or Pixel Document, it validates the input before opening it. The command starts or reuses the loopback server, creates an isolated session, and prints its ID and URL. The optional output directory is the only filesystem root available to session exports. `--host codex --json` returns a one-time in-app-browser `launchUrl`.

## Validate and render

```text
editable-pixel validate <project-or-document>

editable-pixel render <project-or-document>
  [--output <png>]
  [--format color|normal|lit]
  [--scale <1..64>]
  [--frame <id>]
  [--layer <id>]
```

Project rendering uses its single canvas. Normal output uses the stored Layer/Frame Normal pixels. Lit output bakes the selected Frame's stored light. Scaling is nearest-neighbor.

## Export bundle

```text
editable-pixel export <project-or-document>
  --output <directory>
```

The bundle contains the editable canvas document, logical and 8× PNGs, every Frame and Layer PNG, plus a sprite sheet and metadata. The web editor provides Frame/Clip/Project export scopes and GIF/Normal/Lit choices.

## Sessions and selection

```text
editable-pixel session list
editable-pixel session get <session-id>
editable-pixel session close <session-id>
editable-pixel selection get --session <session-id>
```

Session output includes the active Project context when the browser has connected. Closing a session revokes its bootstrap and persistent tokens. The web Canvas and MCP use the same Selection; either the user or the agent can set it.

## Patches and history

```text
editable-pixel patch preview --session <session-id> --patch <file>
editable-pixel patch apply --session <session-id> --patch <file-or-patch-id>
editable-pixel patch reject --session <session-id> --patch <patch-id>
editable-pixel undo --session <session-id>
editable-pixel redo --session <session-id>
```

These Patch commands remain as a compatibility workflow. The bundled Skill uses MCP `get_metadata`, focused context tools, `set_selection`, and immediate `use_editable_pixel` actions by default. Compatibility Preview validates and publishes before/after state without mutation; Apply revalidates the current revision, selection bounds, palette, and outside-selection hash before persisting. Stale revisions and changed files fail instead of using last-write-wins.

## Common error codes

| Code | Meaning |
| --- | --- |
| `OPTION_INVALID` | An option is outside its documented range |
| `OUTPUT_EXISTS` | The destination would be overwritten |
| `OUTPUT_COLLISION` | Generated outputs resolve to the same destination |
| `DOCUMENT_INVALID` | Pixel Document validation failed |
| `PROJECT_INVALID` | Pixel Project validation failed |
| `PROJECT_REVISION_CONFLICT` | Project persistence expected another revision |
| `SERVER_NOT_RUNNING` / `SERVER_UNREACHABLE` | No usable local daemon is available |
| `SESSION_NOT_FOUND` | The session was closed or the ID is wrong |
| `SELECTION_REQUIRED` | Select pixels in the browser first |
| `PATCH_INVALID` | Patch coordinates, colors, or contents are invalid |
| `REVISION_CONFLICT` | The document advanced after patch creation |
| `FILE_CONFLICT` | The opened file changed outside the session |
| `AUTH_INVALID` | A local token is missing, invalid, or expired |
| `SKILL_EXISTS` | Skill installation found an existing directory without `--force` |

Run `editable-pixel <command> --help` for command-local details.
