import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const manifestPaths = [
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".mcp.json"
] as const;

const readManifest = (relativePath: string): unknown =>
  JSON.parse(readFileSync(join(repositoryRoot, relativePath), "utf8"));

const readSource = (relativePath: string): string =>
  readFileSync(join(repositoryRoot, relativePath), "utf8");

/**
 * The version used to be hand-maintained in six places. Three are the JSON host
 * manifests checked below; the canonical one is the CLI package manifest; the
 * remaining two were string literals compiled into shipped binaries —
 * `--version` output and the MCP handshake — where a stale value shipped
 * silently because nothing read them back.
 *
 * Those two are now injected at build time by tsup's `define`, so the guard
 * inverts: instead of matching a literal against the canonical value, it asserts
 * no literal is left to drift, and that each call site actually reads the
 * injected constant. A refactor that reintroduces a hardcoded version, or that
 * detaches a call site from the shared constant, must fail here.
 *
 * That the injection produces the right value at runtime is covered where it can
 * actually be observed: the resolver unit tests in each package, and
 * `tests/distribution/package-install.mjs`, which runs the built `--version` and
 * the real MCP handshake against the packed tarball.
 */
const injectedVersionSites = [
  {
    file: "packages/pixel-cli/src/cli.ts",
    description: "commander .version() for `editable-pixel --version`",
    pattern: /\.version\(packageVersion\)/
  },
  {
    file: "packages/pixel-mcp/src/index.ts",
    description: "McpServer serverInfo.version in the MCP handshake",
    pattern: /name:\s*"editable-pixel-mcp-server"\s*,\s*version:\s*packageVersion/
  }
] as const;

/**
 * Files that must not carry a version literal at all. The resolver modules are
 * excluded deliberately — they are where the fallback reads the canonical
 * manifest, and they hold no literal of their own.
 */
const literalFreeSources = [
  "packages/pixel-cli/src/cli.ts",
  "packages/pixel-mcp/src/index.ts"
] as const;

describe("dual host plugin manifests", () => {
  it("parses every host manifest as a valid JSON object", () => {
    for (const path of manifestPaths) {
      const manifest = readManifest(path);

      expect(manifest, path).toBeTypeOf("object");
      expect(manifest, path).not.toBeNull();
      expect(Array.isArray(manifest), path).toBe(false);
    }
  });

  it("keeps host plugin versions aligned with the published CLI package", () => {
    const { version } = readManifest("packages/pixel-cli/package.json") as { version: string };

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((readManifest(".claude-plugin/plugin.json") as { version: string }).version).toBe(version);
    expect((readManifest(".codex-plugin/plugin.json") as { version: string }).version).toBe(version);
    expect(
      (readManifest(".claude-plugin/marketplace.json") as { plugins: { version: string }[] })
        .plugins[0]?.version
    ).toBe(version);
  });

  it.each(injectedVersionSites)(
    "reads the build-injected version at the $description call site",
    ({ file, pattern }) => {
      const source = readSource(file);
      // Dedupe the flags: a pattern that already carries `g` would otherwise
      // produce "gg" and throw at construction instead of failing a comparison.
      const flags = [...new Set(`${pattern.flags}g`)].join("");
      const matches = [...source.matchAll(new RegExp(pattern, flags))];

      // A refactor that reshapes the call site must fail loudly here rather than
      // leave the injection unguarded.
      expect(matches, `${file}: no injected version site matched ${String(pattern)}`).toHaveLength(1);
      expect(source, file).toMatch(/import \{ packageVersion \} from "\.\/version\.js";/);
    }
  );

  it.each(literalFreeSources)("leaves no hardcoded version literal in %s", (file) => {
    const { version } = readManifest("packages/pixel-cli/package.json") as { version: string };
    const source = readSource(file);

    // Anchored to the canonical value rather than any semver shape: unrelated
    // pinned versions (a protocol revision, a dependency range) are legitimate,
    // but a copy of the release version is exactly the drift being removed.
    expect(source.includes(`"${version}"`), `${file}: still hardcodes "${version}"`).toBe(false);
  });

  it("points the Codex manifest at the shared MCP config that exists on disk", () => {
    const { mcpServers } = readManifest(".codex-plugin/plugin.json") as { mcpServers: string };

    expect(mcpServers).toBe("./.mcp.json");
    expect(existsSync(join(repositoryRoot, mcpServers)), mcpServers).toBe(true);
    expect(() => readManifest(mcpServers)).not.toThrow();
  });

  it("launches the published MCP bin through npx in the shared MCP config", () => {
    const { mcpServers } = readManifest(".mcp.json") as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(mcpServers["editable-pixel"]?.command).toBe("npx");
    expect(mcpServers["editable-pixel"]?.args).toEqual([
      "-y", "-p", "editable-pixel@latest", "editable-pixel-mcp"
    ]);
  });
});
