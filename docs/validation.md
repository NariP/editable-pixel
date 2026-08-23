# Validation record

This file records evidence against the final product goal. Automated checks are not presented as external user research.

## Engineering verification — 2026-08-21

| Check | Result | Evidence |
| --- | --- | --- |
| Build, lint, type-check, unit/integration | Pass | `pnpm verify`; 73 tests across document, core, renderer, converter, web, server, CLI, MCP, and cross-package suites |
| Browser session E2E | Pass | `pnpm test:e2e`; 5 Chromium tests covering token exchange, host/client display, fit, selection sync/reconnect, bounded patch apply/reject, atomic palette-addition patches, session undo/redo, rapid sequential Canvas edits, source retention, same-tab refresh recovery, clean/edited reconversion variants, Content Frame application, custom fixed-palette batch import, presets, comparison thumbnails, canonical session updates, and Codex-width Inspector Sheet behavior |
| Clean package distribution | Pass | `pnpm test:distribution`; pack contents, SHA-256, isolated install, reinstall, CLI validate, two concurrent isolated `open` calls on one daemon, MCP startup, session close, and uninstall |
| Security boundaries | Pass | Loopback bind, Origin/Host rejection, one-time token consumption, closed-token rejection, file-conflict rejection, symlink/traversal rejection, request limits |
| Converter matrix | Pass | PNG/WebP/JPEG, unsupported-format and invalid-option errors, transparent/solid/local-adapter backgrounds, square/non-square, 1 px and 1024×512 sources, center/bottom alignment, fixed/automatic palettes, dithering on/off, batch determinism |
| Renderer round trip | Pass | Byte-identical repeated PNG, nearest preview, layer/frame output, sprite metadata, logical PNG reimport, Canvas RGBA equals CLI-rendered PNG RGBA |
| MCP protocol | Pass | In-memory MCP client/server initialization, exact tool list and annotations, missing-selection guidance, create→preview→apply→render |
| Agent skill | Pass | Skill package validator; Codex and Claude command references checked against local CLI help |
| Workflow and templates | Pass | CI/release and issue-template YAML parsed; CI runs verify, Chromium E2E, and distribution tests |
| Codex in-app flow | Pass as implementation integration | A local session was opened in the Codex browser, a 4×3 rectangle was selected, and the same coordinates were read through the CLI. This is not counted as external target-user validation. |

## Goal checklist audit

The implementation and automated evidence cover 23 of the 24 final checklist lines as product capabilities:

- Conversion and normalization for PNG, WebP, JPEG, backgrounds, canvas, palette, footprint, pivot, alignment, and shared batch settings.
- Pixel Document preservation of palette, layers, frames, regions, selection, source digest, and conversion metadata.
- Web Source/Variant reconversion, same-tab recovery, Content Frame guides, Canvas editing/navigation, synchronized transparent-area selection, palette extension, patch review, apply/reject, history, and all export forms.
- Shared CLI/MCP session and renderer behavior, deterministic output, stale-revision rejection, and outside-selection invariants.
- Loopback, path, token, Origin/Host, conflict, size, and rate boundaries.
- Installable package contents, host setup docs, release automation, license, contribution/security docs, and public interface references.

That count is not a claim that the overall Goal is complete. The following completion gates remain outside the automated implementation run:

- **Pending — repeat use by actual target users with a different second image.** The automated E2E imports and switches between two different images, but that is not a substitute for a person who creates pixel images with AI choosing to use the workflow again.
- **Pending by maintainer choice — public release.** The repository remains private and neither the npm package nor a GitHub Release has been published. The release workflow and installable tarball are verified, but repository visibility, tag push, package publication, and the live release must wait until the maintainer explicitly chooses to publish after development.

## Target-user repeat-use protocol

For each participant, use two of their own AI-generated pixel-style images in separate tasks. Do not collect the source images unless they explicitly consent; a written observation is sufficient.

Record:

| Field | First image | Different second image |
| --- | --- | --- |
| Asset type and input format |  |  |
| Conversion settings changed |  |  |
| Could compare source/result |  |  |
| Could select the intended rectangle |  |  |
| Agent patch stayed in bounds |  |  |
| Could understand preview/apply/reject |  |  |
| Export used |  |  |
| Completion time |  |  |
| Blocking issue or workaround |  |  |
| Would choose this workflow again |  |  |

The goal can be marked complete only after repeat-use results are recorded for actual target users and any blocking product defect found there is fixed and reverified.
