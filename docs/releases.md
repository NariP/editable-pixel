# Release process

Editable Pixel uses one version for the CLI, built web editor, local server, MCP executable, and bundled internal libraries. Public releases are created from `v*` tags.

## Automated release

The release workflow:

1. installs the locked pnpm dependencies on the supported Node.js version;
2. runs build, lint, type-check, unit/integration, browser E2E, packaged-distribution, and clean source-checkout installation tests;
3. packs the `editable-pixel` npm tarball;
4. archives the `skills/editable-pixel` directory;
5. writes SHA-256 checksums for both assets;
6. publishes the npm package with provenance when `NPM_TOKEN` is configured;
7. creates a GitHub Release containing the tarball, skill archive, and checksums.

The workflow uses the Git tag as the release trigger but validates that the tag version matches `packages/pixel-cli/package.json` before publishing.

## Maintainer checklist

1. Bump `version` in `packages/pixel-cli/package.json`, run `pnpm sync-version` to propagate it to the host plugin manifests, and update the user-facing compatibility notes. `--version` output and the MCP handshake need no edit: the build injects them from the same field.
2. Confirm the release notes state the supported Pixel Document version (`1`).
3. Run `pnpm verify`, `pnpm test:e2e`, `pnpm test:distribution`, and `pnpm test:source-install` locally.
4. Confirm `npm pack --dry-run` contains the three executables, `web/index.html`, README files, and license.
5. Create and push an annotated `vX.Y.Z` tag.
6. Verify the GitHub Release checksums and install the uploaded tarball in a clean temporary prefix.
7. Verify `editable-pixel --version` and `editable-pixel-mcp` startup from the released package.

## Compatibility policy

### 2.0.0

- **Breaking MCP response change:** mutation, selection, Undo/Redo, and preview responses no longer include full document/session snapshots. Both text and structured content return compact revision/target/result summaries. Consumers needing document details must use focused reads such as `get_metadata`, `get_palette_context`, or `get_design_context`. HTTP session and browser WebSocket snapshots remain full. See [the MCP migration contract](./mcp.md#response-compatibility).
- Adds `remap_colors` for one-call recoloring from frozen original pixels and `operations` for ordered partial-success batches. Valid items apply together; failures and skipped dependencies return identifiers and reasons. One Undo restores the successful subset. New batch/remap calls require `base_revision`; existing single-action inputs remain supported.
- Fixes duplicate stdio server startup in the installed MCP executable. One tool call now sends one mutation request instead of potentially applying twice or returning a conflict after applying. Workspace developers should use `packages/pixel-mcp/dist/stdio.js` for direct execution; `dist/index.js` is a library export.
- Fixes sprite-sheet import palette/blank-frame handling, concurrent import/save protection, project reopen revision handling, and import error notices. Uses system fonts without a remote font request.
- Recomputes content bounds after remapping transparent/opaque colors so later content resizing preserves the edited pixels.
- Requires **Node.js 24 or newer** and remains compatible with **Pixel Document version `1`**. Windows x64 npm support is unchanged.
- Update explicitly with `npm install --global editable-pixel@2.0.0` (`npm.cmd` on Windows), then rerun `editable-pixel install-skill --host codex`, `--host claude`, or `--host both` for the hosts you use. Save open work, stop the old local server, and restart/reconnect the host so its MCP process and bundled skill use the new version.

### 1.0.4

- **Requires Node.js 24 or newer.** Node 20 reached end of life in April 2026, and the previous `>=20.9.0` floor was already unmet in practice: `commander@15`, a dependency, requires `>=22.12.0`. Installing on Node 20 or 22 now fails with `EBADENGINE`, and `install.sh` refuses rather than proceeding.
- Reads the development and CI runtime from `.nvmrc`, so the version is stated once instead of in nine places.
- Activates pnpm through Corepack from the `packageManager` field. Contributors should run `corepack enable pnpm` — the unscoped `corepack enable` also shims npm, and that shim refuses to run inside this repository.
- Fixes session IDs that began with `-`, which an argument parser read as an option flag and which made `--session <id>` fail for roughly one session in 64.
- Pins line endings through `.gitattributes` so checkouts match across platforms.
- Remains compatible with Pixel Document version `1`.

### 1.0.3

- Reduces the installed package from about 50 MB to about 19 MB, so `npm install -g` and the first `npx` run download and unpack less.
- Replaces the sharp native image codec with the `@jsquash` WebAssembly codecs. PNG, JPEG, and WebP input and PNG output behave the same; installation no longer depends on a platform-specific native binary.
- Loads the Pretendard webfont from a CDN instead of bundling it. Offline installations, or environments that block the CDN, fall back to the operating system UI font: text including Korean still renders, but the typeface differs.
- Adds Claude Code and Codex plugin marketplace installation through `.claude-plugin/`, `.codex-plugin/`, and `.mcp.json`. The existing `npm i -g editable-pixel` plus `editable-pixel install-skill` path is unchanged.
- Excludes source maps and README screenshots from the published archive.
- Remains compatible with Pixel Document version `1`.

### 1.0.2

- Adds Windows x64 npm installation support, including Codex/Claude `.cmd` launcher handling and CLI startup from Windows short (8.3) paths.
- Fixes `install.sh` version checks when the installation path contains spaces.
- Verifies Windows x64 and Linux with unit/integration tests, Chromium E2E, packaged install/update/remove, conversion/rendering, MCP stdio, and clean source installation.
- Tests host registration with isolated fixture CLIs; authenticated Codex/Claude GUI integration, default-browser launching, and Windows ARM64 remain unverified.
- Requires Windows npm installation paths without `&` because of an upstream npm `.cmd` wrapper limitation. Image file arguments containing `&` are supported.
- Remains compatible with Pixel Document version `1`.

### 1.0.1

- Publishes the current main-branch CLI, browser editor, local server, MCP, and skill bundle.
- Fixes npm tarball path handling in the release workflow.
- Includes the updated README demo and browser/MCP parity regression coverage.
- Remains compatible with Pixel Document version `1`.

### Versioning rules

- Pixel Document `version` changes only when the on-disk schema is incompatible.
- Supported older formats are migrated explicitly; future formats are rejected.
- CLI JSON shapes and MCP tool input/output schemas are public interfaces. Breaking changes require a major package version.
- A patch is compatible only with its exact document ID and base revision.
- The skill archive documents the same CLI and MCP version shipped in that release.

## Verify checksums

```bash
shasum -a 256 --check SHA256SUMS
```

The public repository and npm publication do not occur merely because the local build succeeds; they occur only after the maintainer pushes a release tag and the protected workflow completes.
