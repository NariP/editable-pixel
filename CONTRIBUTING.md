# Contributing to Editable Pixel

Thanks for helping improve the AI-generated pixel asset workflow. Contributions should preserve the product boundary: Editable Pixel refines generated raster assets and enables selection-bounded agent edits; it is not a general-purpose drawing application.

## Development setup

Requirements:

- Node.js 20.9 or newer
- pnpm 10.29.3 through Corepack
- macOS, Linux, or Windows with the native dependencies supported by Sharp

```bash
corepack enable
pnpm install
pnpm verify
```

Install Chromium once before browser tests:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Repository boundaries

- `packages/pixel-document` owns the file format, validation, migration, and serialization.
- `packages/pixel-core` owns deterministic document changes and patches.
- `packages/pixel-converter` owns raster conversion and batch normalization.
- `packages/pixel-renderer` owns Canvas buffers and image exports.
- `packages/pixel-server` owns loopback sessions, file authorization, and synchronization.
- `apps/web`, the CLI, MCP server, and skill consume those shared packages rather than reimplementing pixel logic.

Preserve these invariants:

1. `.pixel.json` is the source of truth; PNG is an export.
2. The same input and options produce the same document and rendered bytes.
3. A bounded edit changes no pixel outside the selected rectangle.
4. A patch is previewable before apply and rejects stale revisions.
5. Local files stay local, and the server remains loopback-only by default.

## Making a change

1. Create a focused branch.
2. Add or update tests at the package boundary where behavior is owned.
3. Run `pnpm verify`.
4. Run `pnpm test:e2e` for web, server, session, CLI, MCP, or packaging changes.
5. Update public documentation when a command, tool, schema, security boundary, or compatibility promise changes.

Do not commit generated package contents under `packages/pixel-cli/web`, local agent directories, credentials, session tokens, fixture outputs, or built archives.

## Pull requests

A pull request should explain the user problem, the chosen boundary, and how it was verified. Keep unrelated refactors out of the change. Compatibility changes to Pixel Document, CLI output, or MCP schemas must include migration or upgrade notes.

Security issues should follow [SECURITY.md](./SECURITY.md), not a public issue.
