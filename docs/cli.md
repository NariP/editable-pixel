# CLI reference

The `editable-pixel` CLI is both the human interface and the fallback interface for agents when MCP is unavailable. It prints concise text by default and stable JSON with the global `--json` flag. Failures use a non-zero exit code and emit `{ "error": { "code", "message" } }` on stderr.

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

`--size` supplies the square default; `--width` and `--height` override either dimension for a custom rectangular canvas. `--palette` uses the exact fixed palette and takes precedence over `--colors`. Multiple inputs use a shared palette and normalization target. Before a batch or export bundle writes anything, every destination is checked so a collision cannot leave a partial result. The CLI never overwrites an existing output.

```bash
editable-pixel convert portrait.png \
  --width 24 --height 32 \
  --palette "#00000000,#26314fff,#f4d35eff" \
  --output portrait.pixel.json
```

## Open

```text
editable-pixel open <document>
  [--output-directory <path>]
  [--host browser|codex|claude]
  [--no-browser]
```

`open` validates the document, starts or reuses the local server, creates an isolated session, and prints its ID and URL. The output directory is the only location that session may use for exports. `codex` returns a one-time `launchUrl` in JSON for the in-app browser; do not persist it.

## Validate and render

```text
editable-pixel validate <document>
editable-pixel render <document>
  [--output <png>]
  [--scale <1..64>]
  [--frame <id>]
  [--layer <id>]
```

Scale 1 renders the logical canvas. Larger scales use nearest-neighbor output. Supplying a layer renders only that layer.

## Export bundle

```text
editable-pixel export <document> --output <directory>
```

The command writes `document.pixel.json`, `logical.png`, `preview-8x.png`, all frame PNGs, all layer PNGs, `sprite-sheet.png`, and `sprite-sheet.json`. Existing files are not overwritten.

## Sessions and selection

```text
editable-pixel session list
editable-pixel session get <session-id>
editable-pixel session close <session-id>
editable-pixel selection get --session <session-id>
```

Closing a session discards its in-memory state and revokes its bootstrap and persistent tokens. The selection command returns `null` until the user has dragged a rectangle in the web editor.

## Patches and history

```text
editable-pixel patch preview --session <session-id> --patch <file>
editable-pixel patch apply --session <session-id> --patch <file-or-patch-id>
editable-pixel patch reject --session <session-id> --patch <patch-id>
editable-pixel undo --session <session-id>
editable-pixel redo --session <session-id>
```

Preview validates the patch and publishes its before/after state to the web editor without mutating the document. Apply persists a valid patch and increments the revision. Reject discards a pending preview. Stale revisions, changed before-values, changed source files, and out-of-selection changes fail with stable error codes.

## Common error codes

| Code | Meaning |
| --- | --- |
| `OPTION_INVALID` | A command option is outside its documented range |
| `OUTPUT_EXISTS` | The destination would be overwritten |
| `OUTPUT_COLLISION` | Two generated assets would resolve to the same destination |
| `DOCUMENT_INVALID` | Schema or semantic validation failed |
| `SERVER_NOT_RUNNING` / `SERVER_UNREACHABLE` | No usable local daemon is available |
| `SESSION_NOT_FOUND` | The session was closed or the ID is wrong |
| `SELECTION_REQUIRED` | Select a rectangle in the browser first |
| `PATCH_INVALID` | Coordinates, colors, or patch contents are invalid |
| `REVISION_CONFLICT` | The document has advanced since patch creation |
| `FILE_CONFLICT` | The opened document changed outside the session |
| `AUTH_INVALID` | A local token is missing, invalid, or expired |

Run `editable-pixel <command> --help` for command-local flags and examples.
