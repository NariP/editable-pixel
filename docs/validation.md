# Validation record

This file records implementation evidence for the final Project-based product goal. Automated checks are implementation evidence, not a claim of external user research or public release.

## Final engineering verification — 2026-09-01

| Check | Result | Evidence |
| --- | --- | --- |
| Build, lint, type-check, unit/integration | Pass | `pnpm verify`; build and static checks passed, followed by 174 tests across Project, document, core, renderer, converter, web, server, CLI, MCP, and cross-package suites |
| Browser session E2E | Pass | `pnpm test:e2e`; 21 Chromium tests passed, including semantic MCP browser commands, AI selection visibility, file import, immediate agent editing, shared browser Undo/Redo, and confirmed deletion of a recent local Project |
| Distribution install | Pass | `pnpm test:distribution`; tarball contents, public docs/media, Skill bundle, SHA-256, isolated install/reinstall, source-less `open`, `install-skill`, CLI execution, concurrent Codex/Claude sessions, MCP startup, session close, uninstall, and binary removal passed |
| Clean source install | Pass | `pnpm test:source-install`; a temporary source checkout without `.git`, `node_modules`, or build output completed frozen-lockfile install, full build, and development-server HTTP startup without depending on an already-populated pnpm package store |
| Skill package | Pass | The bundled `editable-pixel` Skill passed the Skill validator and was copied to isolated Codex and Claude targets through `editable-pixel install-skill` |
| Host MCP registration | Pass | `editable-pixel install-skill --host both --force` registered an absolute Node executable and packaged MCP entrypoint. `codex mcp get editable-pixel` reported enabled stdio; `claude mcp get editable-pixel` reported user-scope connected stdio. A fresh stdio client negotiated MCP, listed 27 tools, found all four web bridge tools, called `list_sessions`, and called `get_metadata` successfully. |
| Codex in-app browser | Pass | A temporary Pixel Document was opened in an actual Codex in-app browser tab. An MCP client selected `(0,0) 2×2`, the existing Select tool became active and displayed the same selection, an immediate AI paint action changed all four cells to palette index `4`, browser Undo restored index `0`, and browser Redo restored index `4`. The tab reached revision `25` without console warnings or errors; the temporary document was returned to its original pixels afterward |
| Documentation | Pass | English/Korean README, Goal and decisions, install, CLI, MCP, security, and Skill references were aligned with immediate action, shared selection/history, and host installation behavior |

## Toon palette verification — 2026-08-25

| Check | Result | Evidence |
| --- | --- | --- |
| Discrete renderer | Pass | Renderer tests verify a generated cool-shadow/base/warm-highlight ramp, preserve the authored base color exactly, and keep Smooth lighting as an explicit compatibility mode |
| Lighting model | Pass | Pixel Document validation accepts `shading: "toon-palette" | "smooth"` and 3–6 Toon steps; numeric lighting fields interpolate while discrete shading settings stay on their originating keyframe |
| Browser controls | Pass | The actual Codex in-app browser exposed Toon palette and 4-step controls in Edit → Normal → Lit and reached the verified state without console warnings or errors |
| 64×64 robot | Pass | A disposable 64×64, eight-frame robot Project was rendered with Normal Maps, Toon palette lighting, Ambient 65%, and one shared light across all Frames; CLI validation and 8× Lit PNG export passed |
| Packaged surface | Pass | MCP frame-lighting actions, the bundled Skill reference, the web editor, and distribution install include the Toon shading fields and controls |

## Browser E2E coverage

The final 21-test browser suite verifies:

- connected session selection sync, stale-cache recovery, reload/reconnect, sequential revisions, and queued offline edits;
- Canvas navigation, `Z`-drag zoom, Fit, layer DnD, selection history, Delete/Backspace/Cut, copy/paste placement, occupied-pixel overwrite, multi-selection stamping, Undo, and Redo;
- Figma-style AI context access, existing Selection Tool synchronization, immediate selection-bounded AI actions, actor-attributed history, and shared browser Undo/Redo;
- semantic browser context/control commands for tabs, tools, active targets, view state, Pixel JSON import, and AI-attributed shared history without coordinate-based UI clicks;
- compatibility Patch preview/application, outside-selection rejection, and revision safety;
- conversion preview stability, numeric input commit-on-blur, and deterministic conversion paths;
- all five Import purposes: `Replace Canvas`, `Add as Frames`, `Import Sprite Sheet`, `Add Source`, and `Replace Source`;
- retained Source ownership, ordered animation Frames, exact Frame durations, real `GIF89a` download, and the Codex-width Inspector Sheet.

## Goal checklist audit

The final implementation satisfies the Project goal as follows:

- `@editable-pixel/project` owns validated Project/Source/Clip state, its single Pixel Document, schema versioning, cloning, serialization, revision commits, and autosave state.
- The web runtime is Project-rooted. Current state and new storage no longer create Variant or V1/V2; the legacy type is read-only migration input.
- A Project owns one source-less or source-backed Pixel Document together with its Layers, Frames, Clips, Sources, Normal Maps, and per-frame Lighting.
- Meaningful editing transactions, Undo, and Redo feed Project autosave. Server persistence is atomic and rejects stale expected revisions.
- Reconnecting Canvas edits remain visible in the browser, retain their original base revisions, and flush in order after the connection recovers; unexpected revision paths become conflicts.
- Save As clones the whole Project with a new ID and name. Project JSON embeds retained Source data with digests and does not persist absolute source paths.
- CLI and MCP expose bounded metadata/design/palette/motion/history context, canonical selection commands, immediate editing actions, compatibility Patch operations, validation, sessions, and permitted exports.
- User and AI actions share one revisioned history. History entries identify `actor`, `client`, reason, selection, and applied/undone state without storing full artwork payloads in read responses.
- The bundled Skill follows a sparse `metadata → design context → screenshot` flow, installs for Codex and Claude, and applies edits immediately without a mandatory preview-approval step.
- Export supports Current Frame, Current Clip, and Entire Project ownership scopes across the applicable Color PNG, Normal PNG, Lit PNG, GIF/Sprite Sheet, Pixel JSON, and Pixel Project outputs.
- Renderer and converter tests cover deterministic nearest-neighbor results, Normal/Lit output, layer/frame composition, GIF animation, and non-mutation of source documents.
- The packaged server stays on loopback and enforces session token, Origin/Host, request/payload, output-path, traversal, symlink, and revision-conflict boundaries.

## Manual in-app evidence boundary

The final manual pass used a disposable copy of the repository fixture, not the user's artwork. It verified the complete connected path from an MCP selection command and immediate action through the live WebSocket UI, visible Select state, revision updates, actor-attributed history, and the browser's own Undo/Redo controls. The disposable file was restored after the check. The same flow is also fixed as a deterministic Chromium E2E case.

## Publication boundary

The implementation and local distribution are ready for publication, but publication is intentionally outside the completed implementation Goal. The repository remains private, and no npm package, GitHub Release, visibility change, or public tag is created until the maintainer explicitly requests release.
