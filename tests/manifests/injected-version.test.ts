import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const canonicalManifestPath = "packages/pixel-cli/package.json";

const injectedIdentifier = "__EDITABLE_PIXEL_VERSION__";

/**
 * The two shipped artifacts that carry a version. `dist/cli.js` holds the
 * commander `--version` call site. `dist/mcp.js` holds the MCP handshake's
 * `serverInfo.version`, whose resolver lives in `packages/pixel-mcp` and reaches
 * this bundle only because tsup inlines that package.
 *
 * `dist/server-runner.js` is deliberately absent: it carries no version surface.
 */
const injectedArtifacts = [
  "packages/pixel-cli/dist/cli.js",
  "packages/pixel-cli/dist/mcp.js"
] as const;

const canonicalVersion = (): string => {
  const { version } = JSON.parse(
    readFileSync(join(repositoryRoot, canonicalManifestPath), "utf8")
  ) as { version?: unknown };

  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`${canonicalManifestPath}: no usable version`);
  }
  return version;
};

/**
 * Reading a build artifact from a unit test is unusual, so: the alternative is
 * that nothing checks this before release. The `define` injection in
 * `packages/pixel-cli/tsup.config.ts` rests on three independent links, and
 * every way of breaking one is silent at build time and loud only in
 * production:
 *
 * 1. `@editable-pixel/mcp` must stay out of tsup's `external` list. Added there,
 *    it survives as a bare import, its `__EDITABLE_PIXEL_VERSION__` is never
 *    substituted, and `dist/mcp.js` falls back to a disk read with no canonical
 *    manifest to find once published.
 * 2. `packages/pixel-mcp/package.json` must keep resolving to output that still
 *    carries the identifier. Deleting `dist/` fails the build loudly, but adding
 *    an `exports` map that redirects to some other prebuilt file does not: the
 *    bundle succeeds and quietly ships whatever version that file resolved.
 * 3. The identifier must stay a bare free identifier at every call site.
 *    `define` substitutes text, so a rename, a destructure, or a
 *    `globalThis.__EDITABLE_PIXEL_VERSION__` read all stop matching.
 *
 * Two assertions close all three: the resolver call site must carry the
 * canonical version literal, and the identifier must be gone.
 * `tests/distribution/package-install.mjs` covers the same ground against the
 * packed tarball, but it runs only under `pnpm test:distribution` and in the
 * release workflow — not under `pnpm verify`, which is what a maintainer runs
 * before tagging.
 */
const readArtifact = (relativePath: string): string => {
  const absolute = join(repositoryRoot, relativePath);

  // Skipping a missing artifact would be exactly the silent pass this guard
  // exists to remove, so it fails with the command that fixes it. `pnpm verify`
  // runs `build` before `test`, so this only fires when `pnpm test` is run on
  // its own against a checkout that was never built.
  if (!existsSync(absolute)) {
    throw new Error(
      `${relativePath} is missing. Run \`pnpm build\` before \`pnpm test\` ` +
      "(`pnpm verify` does both in order); this guard checks the built artifact."
    );
  }
  return readFileSync(absolute, "utf8");
};

describe("build-time version injection", () => {
  it.each(injectedArtifacts)("substitutes the canonical version into %s", (relativePath) => {
    const version = canonicalVersion();
    const artifact = readArtifact(relativePath);
    // Anchored to the resolver call site rather than a free-floating literal, so
    // an unrelated `"1.0.3"` in a bundled dependency cannot stand in for the
    // injection. The `true ? ... : void 0` shape is what `define` leaves behind
    // after substituting into the `typeof` guard in `src/version.ts`.
    const injectedCall = new RegExp(
      `resolveVersion\\(\\s*(?:true\\s*\\?\\s*)?${JSON.stringify(version)}`
    );

    // A stale artifact fails here too, and should: it means the last build
    // predates the version bump, which is the drift this issue removes.
    expect(
      injectedCall.test(artifact),
      `${relativePath}: the version resolver was not called with "${version}". The tsup ` +
      "`define` did not reach this artifact, or it was built before the version was " +
      "bumped — rebuild, then check `external` and `src/version.ts`."
    ).toBe(true);
  });

  it.each(injectedArtifacts)("leaves no unsubstituted identifier in %s", (relativePath) => {
    const artifact = readArtifact(relativePath);

    // The identifier survives only where `define` missed it, and there it
    // resolves to `undefined` and drops into the disk fallback, which has no
    // canonical manifest to read once the package is published.
    expect(
      artifact.includes(injectedIdentifier),
      `${relativePath}: \`${injectedIdentifier}\` was not substituted. Check that ` +
      "`@editable-pixel/mcp` is absent from tsup's `external` list, that its `main` " +
      "resolves to `dist/index.js`, and that the identifier is still read as a bare " +
      "free identifier."
    ).toBe(false);
  });
});
