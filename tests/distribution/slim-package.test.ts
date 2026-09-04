import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const read = (relativePath: string): string =>
  readFileSync(join(repositoryRoot, relativePath), "utf8");

/**
 * The published archive is assembled from two independent rules: the `files`
 * allowlist in the CLI manifest, and the copy filters in prepare-package.mjs.
 * Asserting on those rules keeps the guard cheap — the packed-archive
 * equivalent lives in tests/distribution/package-install.mjs, which runs a
 * real `pnpm pack` and would rebuild the workspace on every CI run.
 */
describe("published package stays slim", () => {
  const manifest = JSON.parse(read("packages/pixel-cli/package.json")) as {
    bin: Record<string, string>;
    files: string[];
    scripts: Record<string, string>;
  };
  const prepareScript = read("packages/pixel-cli/scripts/prepare-package.mjs");

  it("ships dist JavaScript without the tsup sourcemaps", () => {
    // Development builds keep `sourcemap: true`; only the archive drops the maps.
    expect(read("packages/pixel-cli/tsup.config.ts")).toContain("sourcemap: true");

    expect(manifest.files).toContain("dist/*.js");
    expect(manifest.files).not.toContain("dist");
    expect(manifest.files.some((entry) => entry.startsWith("dist/") && entry.endsWith(".map"))).toBe(false);

    // `dist/*.js` is a single-level glob, so every declared bin must sit at the
    // dist root — a nested entry would be published as a dangling bin link.
    const binaries = Object.entries(manifest.bin);
    expect(binaries.length).toBeGreaterThan(0);
    for (const [name, entry] of binaries) {
      expect(entry, name).toMatch(/^\.\/dist\/[^/]+\.js$/);
    }

    // Code splitting would emit `dist/chunk-*.js` shared modules; those match
    // the glob, but tsup also writes them for lazily imported entries, so
    // keeping it off is what makes the single-level allowlist sufficient.
    expect(read("packages/pixel-cli/tsup.config.ts")).toContain("splitting: false");
  });

  it("excludes docs/media from the archive while keeping the offline markdown docs", () => {
    expect(manifest.files).toContain("docs");
    expect(prepareScript).toContain('join("docs", "media")');
    expect(prepareScript).toContain('join("docs", "test-assets")');
    // The filter must compare repository-relative paths. A substring test on the
    // absolute path would exclude everything when the checkout itself lives
    // under a directory named `docs/media`.
    expect(prepareScript).toContain("relative(repositoryRoot, source)");

    const excluded = [join("docs", "test-assets"), join("docs", "media")];
    // Mirrors `isPublishedDocumentation` in prepare-package.mjs.
    const isCopied = (checkout: string, relativePath: string): boolean => {
      const source = join(checkout, relativePath);
      const path = relative(checkout, source);
      return !excluded.some((directory) => path === directory || path.startsWith(directory + sep));
    };

    const filtered = ["docs/media/editor-overview.png", "docs/test-assets/sample.png"];
    const kept = ["docs/mcp.md", "docs/project-model.md", "docs/getting-started.md"];

    // Both a normal checkout and one whose own path contains the excluded names.
    for (const checkout of ["/home/ci/editable-pixel", "/home/ci/docs/media/editable-pixel"]) {
      for (const source of filtered) expect(isCopied(checkout, source), `${checkout} ${source}`).toBe(false);
      for (const source of kept) expect(isCopied(checkout, source), `${checkout} ${source}`).toBe(true);
    }
  });

  it("loads Pretendard from the CDN so no webfont is bundled into web/assets", () => {
    const webManifest = JSON.parse(read("apps/web/package.json")) as {
      dependencies: Record<string, string>;
    };

    expect(webManifest.dependencies).not.toHaveProperty("pretendard");
    expect(read("apps/web/src/main.tsx")).not.toContain("pretendard");

    const html = read("apps/web/index.html");
    expect(html).toContain("cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9");
    // The dynamic subset splits by unicode-range, so browsers fetch only the
    // glyph ranges a session actually renders.
    expect(html).toContain("pretendardvariable-dynamic-subset.css");
  });

  it("falls back to system UI fonts when the Pretendard CDN is unreachable", () => {
    const rootFontFamily = /:root\s*\{[^}]*?font-family:\s*([^;]+);/s.exec(read("apps/web/src/styles.css"));
    const declaration = rootFontFamily?.[1];

    expect(declaration).toBeDefined();
    const stack = (declaration ?? "").split(",").map((font) => font.trim().replace(/^["']|["']$/g, ""));

    expect(stack[0]).toBe("Pretendard Variable");
    expect(stack).toContain("Pretendard");
    expect(stack.at(-1)).toBe("sans-serif");

    // Offline Hangul must not collapse to the browser default sans-serif.
    const afterPretendard = stack.slice(stack.lastIndexOf("Pretendard") + 1);
    expect(afterPretendard[0]).not.toBe("sans-serif");
    for (const systemFont of ["-apple-system", "Apple SD Gothic Neo", "Malgun Gothic", "system-ui"]) {
      expect(afterPretendard, systemFont).toContain(systemFont);
    }
  });
});
