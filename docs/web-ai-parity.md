# Web and MCP coverage boundaries

This is a map of automated assertions, not a claim that every web feature has a tested AI equivalent. It also does not certify a particular release or the latest test run. Execution results belong in the change's verification report.

## Representative comparisons

Both tests in [web-mcp-parity.spec.ts](../tests/e2e/web-mcp-parity.spec.ts) use two independent sessions initialized from the same fixture. One browser performs the manual workflow; a second connected browser observes or executes the MCP workflow.

The MCP path is the real SDK `Client` and `InMemoryTransport` connected to `createEditablePixelMcpServer`. Its `PixelServerClient` calls the actual E2E loopback HTTP server, and the browsers use the actual WebSocket server. No MCP handler, transport response, document mutation, or browser command is mocked. In-memory transport validates the MCP schema, normalization and tool handler, but does **not** exercise the packaged stdio executable, host registration, Codex/Claude tool discovery, or a model's natural-language decisions.

| Scope | Manual web path | MCP path | Assertions |
| --- | --- | --- | --- |
| Color selection and move | `Select` drag, `Move selection right`, Undo/Redo buttons | `set_selection`, `use_editable_pixel.move_selection`, `undo`, `redo` | Hand-derived overlapping 2×2 move, visible selection and Canvas update, full semantic document equality, selection and move Undo/Redo independently, actor/client provenance and ordered history |
| Isometric view | `2:1 isometric grid` button | `control_web` with `set_view`, `show_grid`, `grid_mode`; `get_web_context` | Visible 2:1 guide, square guide absent, pressed state and context agree; document, revision and edit history unchanged |

Exact test names:

- `web and MCP Color selection/move share Undo/Redo semantics and preserve normal data`
- `web and MCP isometric grid controls agree without changing document or history`

The document comparison preserves palette, frame order/timing, lighting, layer order/properties, color and normal arrays, bounds, pivot, metadata other than the modifier, and selection. Only document identity, absolute revision and `metadata.modifiedBy` are normalized. Each path's revision increments are checked separately. History IDs/timestamps need not match; reason, order, applied/undone state, selection and revision deltas must match. Browser entries must be `actor=user` from a `web-*` client; MCP entries must be `actor=ai`, `client=mcp`.

For a move, the affected area is the union of source and destination cells, not the source rectangle alone. The fixture checks all other pixels, another frame and another layer remain unchanged. In the tested **Color** move, every normal array is preserved in place; this is not Normal-map move/edit parity coverage. Expected moved pixels are written explicitly, not computed by the production move operation.

## Other retained or strengthened evidence

| Test boundary | Evidence | What it does not establish |
| --- | --- | --- |
| Web components | [App.test.tsx](../apps/web/src/App.test.tsx): workspace smoke includes Content Frame label and Center default; Background/Dither tooltips open and close; custom numeric draft commits on blur/Enter with invalid, blank, rounding and clamp cases; Color count clamps to 2–256 | Static Content Frame visibility does not prove guides are absent from exports; numeric tests do not replace actual image conversion coverage |
| Image import → GIF download | [editor.spec.ts](../tests/e2e/editor.spec.ts): `multiple images import in natural filename order and export matching GIF pixels and timing` | Tests two imported images plus the existing frame, not every image format, export scope or scaling mode |
| Canvas → server synchronization | Same file: `rapid connected-canvas edits keep sequential revisions without conflicts` observes actual sent `document.patch` base revisions and received `state` revisions, conflict/error traffic, and final pixels after several completed gestures | Does not prescribe patch count per pointer event/stroke or simulate concurrent writers |
| Session API → browser | Same file: `Session API web commands read and operate the connected browser without pixel-coordinate clicks`; existing AI selection/edit and bounded patch-preview scenarios | These existing tests call HTTP with an MCP client label. They do not themselves invoke the MCP SDK/protocol |
| Real CLI → browser | Same file: `CLI isometric controls update the visible grid and shared selection history` executes the built CLI using an isolated registry | Does not prove every CLI operation matches every web/MCP path |
| Other browser regressions | Same file retains native clipboard/cut/paste, mask and Normal selection priority, offline queue/reconnect, cached-document ownership, responsive inspector, source/sprite-sheet imports and actual PNG reconversion | Retained regression coverage is not automatically a pairwise MCP comparison |
| MCP package integration | [index.test.ts](../packages/pixel-mcp/src/index.test.ts): SDK tool registration, selected patch/edit, history, selection and isometric diamond tests against a real Session API harness | Registered tool names/annotations alone do not prove every tool's behavior |
| CLI/render integration | [cli-web-render.test.ts](../tests/integration/cli-web-render.test.ts) compares CLI output with the shared renderer | Not a comparison with the live browser Canvas |
| Package/source installation | [package-install.mjs](../tests/distribution/package-install.mjs), [source-install.mjs](../tests/distribution/source-install.mjs) | Package SHA256 is a diagnostic fingerprint, not independent archive integrity verification; executable startup does not prove a real host conversation |

The GIF test deliberately submits `motion-10.png` before `motion-2.png`, then checks the expected natural filename order in the canonical frame arrays and the downloaded GIF. Asymmetric native-size fixtures have independently specified palette/RGBA pixels, and frame delays are 80, 140 and 230 ms. Sharp decodes frame count, width/page height, delays and every RGBA pixel; the expected result never calls the production GIF encoder or derives import order from its output.

## Gaps and unverified capabilities

- **Known mismatch, not an approved exception:** the web `Color count` input has minimum 2, while the semantic browser `set_conversion` handler and converter allow 1. See [App.tsx](../apps/web/src/App.tsx) (`BlurNumberInput` and `set_conversion`) and [converter options](../packages/pixel-converter/src/index.ts). Intent is unconfirmed; this change records the gap without altering product behavior. The input boundary test is not evidence that MCP and web match here.
- These two representative comparisons do not establish pairwise coverage for all selection modes, palette/layer/frame/clip actions, Normal edits, lighting, conversion options/presets, source/project lifecycle, import/export variants, clipboard integration, invalid inputs or concurrent edits. Unmapped capabilities remain **unverified**, not implicitly equivalent or intentionally different.
- `get_metadata`, `get_web_context.capabilities`, the edit action union and semantic browser command union describe different surfaces. In particular, browser capability metadata is not exhaustive (`remove_source` has a handler but is absent from the listed project capabilities). Do not derive a complete feature inventory or percentage from those lists alone.
- Actual Codex/Claude host registration, stdio protocol sessions, agent reasoning and successful natural-language completion require separate host evidence. Setting `host: "codex"` or a client label in an HTTP request is not that evidence.

## Verification commands

Implementation-loop unit coverage: `pnpm test`. The final gate runs `pnpm verify`, `pnpm test:e2e`, `pnpm test:distribution`, and `pnpm test:source-install`. E2E assertions here concern browser workflows and SDK integration; they are not run on each implementation iteration. See [CONTRIBUTING.md](../CONTRIBUTING.md) for environment prerequisites. A coverage row should only be reported as passing with a recorded successful run of its corresponding command.
