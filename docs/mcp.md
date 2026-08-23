# MCP and coding-agent integration

`editable-pixel-mcp` is a local stdio MCP server. It discovers the loopback session daemon through its protected registry and calls only that daemon's API; it does not implement separate pixel-processing logic.

## Register the server

Install the `editable-pixel` npm package first, then run one of the verified host commands:

```bash
# Codex
codex mcp add editable-pixel -- editable-pixel-mcp

# Claude Code, current project
claude mcp add --scope project editable-pixel -- editable-pixel-mcp
```

Start a session before using the tools:

```bash
editable-pixel open ./hero.pixel.json --host codex --json
# or
editable-pixel open ./hero.pixel.json --host claude
```

Codex can open the returned one-time URL in its in-app browser. Claude Code uses the system browser. The browser, CLI, and MCP process still share one session ID, document revision, and selection.

## Tools

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `list_sessions` | No | Paginate active local sessions |
| `get_session` | No | Read revision, clients, selection, and pending patches |
| `get_document_summary` | No | Read canvas, palette, layers, frames, bounds, alignment, and pivot without pixel arrays |
| `get_selection` | No | Read the current browser rectangle |
| `create_patch` | No document mutation | Build a deterministic bounded patch against the current revision |
| `preview_patch` | No document mutation | Validate and show before/after state in the web editor |
| `apply_patch` | Yes | Apply a previously previewed patch ID and persist the document |
| `reject_patch` | Pending state only | Discard a pending preview |
| `undo` | Yes | Apply the inverse of the latest committed edit |
| `redo` | Yes | Reapply the latest undone edit |
| `validate_document` | No | Run schema and semantic validation |
| `render_preview` | No | Return a nearest-neighbor PNG preview as MCP image content |

Every tool uses strict input schemas, structured output, human-readable text, and MCP read/write annotations. `response_format` is available on text tools as `markdown` or `json`. Errors include a stable code and a concrete next action.

## Required edit protocol

1. Call `list_sessions` when no session ID is known.
2. Call `get_session` and `get_selection`.
3. If selection is absent, ask the user to click `[ SELECT AREA ]` and drag a rectangle.
4. Call `create_patch` with the user request, target coordinates, and palette indices. Keep `require_selection` enabled.
   If the requested color is absent, pass one or more `#RRGGBBAA` values in `new_colors`; their indices are appended after the current palette and are applied atomically with the bounded pixel changes.
5. Call `preview_patch` with the returned patch.
6. Wait for the user's instruction to apply or reject the preview.
7. Call `apply_patch` with the pending patch ID or `reject_patch`.
8. Call `get_session` or `validate_document` to confirm the resulting revision.

The server rejects a patch if its revision is stale, its target differs from the active layer/frame, any changed coordinate is outside the selection, the outside-selection hash differs, a new palette entry is invalid or duplicated, or the opened file changed on disk.

## CLI fallback

Every session and patch action has a CLI equivalent. This allows the agent workflow to continue when the host cannot load MCP. See [CLI reference](./cli.md) and the reusable instructions in `skills/editable-pixel`.

## Compatibility

The MCP server, CLI, and Pixel Document implementation ship in the same npm package version. A tagged release records the supported Pixel Document version in its release notes. Unknown future document versions and incompatible patch revisions are rejected rather than coerced.
