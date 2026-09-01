# Read-only MCP evaluation fixture

Open `tests/fixtures/character.pixel.json` as the only active session before running `read-only.xml`:

```bash
editable-pixel --json open tests/fixtures/character.pixel.json --host codex --no-browser
```

The questions use only `list_sessions`, `get_metadata`, `get_design_context`, `get_palette_context`, and `get_motion_context`. They never mutate Selection, pixels, Project structure, files, or History. Expected answers are pinned to the committed `evaluation-fixture` document.
