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
