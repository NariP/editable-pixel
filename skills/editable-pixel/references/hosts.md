# Host-specific open and MCP setup

Install the bundled Skill and register its absolute MCP entrypoint in both hosts:

```bash
editable-pixel install-skill --host both
```

Use `--host codex` or `--host claude` to install only one host. Existing Skill directories and MCP registrations are preserved unless `--force` is explicit. `--target` copies a Skill for testing without touching host configuration; `--no-register-mcp` intentionally skips registration.

## Codex

Verify automatic user-level registration:

```bash
codex mcp list
```

Open a document for the Codex app:

```bash
editable-pixel --json open character.pixel.json --host codex
```

The JSON contains a one-time `launchUrl`. If an in-app browser tool is available, navigate that panel to the URL without repeating it in chat. The server exchanges it for a persistent session token and removes the bootstrap parameter from browser history. If no in-app browser is available, run `editable-pixel open character.pixel.json --host browser` to use the system browser.

## Claude Code

Verify automatic user-level registration:

```bash
claude mcp list
```

Claude Code does not provide the same Codex in-app browser panel. Open the editor in the system browser:

```bash
editable-pixel open character.pixel.json --host claude
```

The browser and Claude MCP process use the same session server. The user or Claude may set the same Canvas Selection, and both edit through the shared History and Undo/Redo stack.

## Plain browser or CLI-only

Use `editable-pixel open character.pixel.json` for the system browser. Conversion, validation, rendering, and export do not require an active browser session.
