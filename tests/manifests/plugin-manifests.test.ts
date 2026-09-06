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
 * The version is hand-maintained in six places. Four are JSON manifests checked
 * above; the remaining two are string literals compiled into shipped binaries —
 * `--version` output and the MCP handshake — where a stale value ships silently
 * because nothing reads them back.
 *
 * Each pattern is anchored to its own call site rather than matching any
 * semver-shaped string, so an unrelated pinned version in the same file cannot
 * satisfy it. Extraction failing is itself a failure: if a refactor moves the
 * literal somewhere this no longer matches, the guard must say so instead of
 * passing on zero matches.
 */
const versionLiterals = [
  {
    file: "packages/pixel-cli/src/cli.ts",
    description: "commander .version() for `editable-pixel --version`",
    pattern: /\.version\(\s*"(\d+\.\d+\.\d+)"\s*\)/
  },
  {
    file: "packages/pixel-mcp/src/index.ts",
    description: "McpServer serverInfo.version in the MCP handshake",
    pattern: /name:\s*"editable-pixel-mcp-server"\s*,\s*version:\s*"(\d+\.\d+\.\d+)"/
  }
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

  it.each(versionLiterals)(
    "keeps the $description version literal aligned with the published CLI package",
    ({ file, pattern }) => {
      const { version } = readManifest("packages/pixel-cli/package.json") as { version: string };
      const source = readSource(file);
      // Dedupe the flags: a pattern that already carries `g` would otherwise
      // produce "gg" and throw at construction instead of failing a comparison.
      const flags = [...new Set(`${pattern.flags}g`)].join("");
      const matches = [...source.matchAll(new RegExp(pattern, flags))];

      // A refactor that reshapes the call site must fail loudly here rather than
      // leave the literal unguarded.
      expect(matches, `${file}: no version literal matched ${String(pattern)}`).toHaveLength(1);
      expect(matches[0]![1], file).toBe(version);
    }
  );

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
