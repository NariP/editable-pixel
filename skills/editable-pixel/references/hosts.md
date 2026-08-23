# Host-specific open and MCP setup

## Codex

Register the project-local stdio MCP server once:

```bash
codex mcp add editable-pixel -- editable-pixel-mcp
```

Open a document for the Codex app:

```bash
editable-pixel --json open character.pixel.json --host codex
```

The JSON contains a one-time `launchUrl`. If an in-app browser tool is available, navigate that panel to the URL without repeating it in chat. The server exchanges it for a persistent session token and removes the bootstrap parameter from browser history. If no in-app browser is available, run `editable-pixel open character.pixel.json --host browser` to use the system browser.

## Claude Code

Register the project-local stdio MCP server once:

```bash
claude mcp add --scope project editable-pixel -- editable-pixel-mcp
```

Claude Code does not provide the same Codex in-app browser panel. Open the editor in the system browser:

```bash
editable-pixel open character.pixel.json --host claude
```

The browser and Claude MCP process use the same session server. The user selects pixels in the browser and continues the edit in Claude Code.

## Plain browser or CLI-only

Use `editable-pixel open character.pixel.json` for the system browser. Conversion, validation, rendering, and export do not require an active browser session.
