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

1. Update the package version and user-facing compatibility notes.
2. Confirm the release notes state the supported Pixel Document version (`1`).
3. Run `pnpm verify`, `pnpm test:e2e`, `pnpm test:distribution`, and `pnpm test:source-install` locally.
4. Confirm `npm pack --dry-run` contains the three executables, `web/index.html`, README files, and license.
5. Create and push an annotated `vX.Y.Z` tag.
6. Verify the GitHub Release checksums and install the uploaded tarball in a clean temporary prefix.
7. Verify `editable-pixel --version` and `editable-pixel-mcp` startup from the released package.

## Compatibility policy

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
