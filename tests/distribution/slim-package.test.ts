import { readFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The real filter, imported rather than mirrored. prepare-package.mjs copies at
// module scope, so its side-effect-free half lives in its own module precisely
// so this suite can call the shipped rule instead of a look-alike that drifts.
import {
  excludedDocumentationDirectories,
  isPublishedDocumentation
} from "../../packages/pixel-cli/scripts/published-documentation.mjs";

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
    // The exclusion list is the shipped one, so a rename here is a test failure
    // rather than a silent divergence between script and guard.
    expect(excludedDocumentationDirectories).toEqual([
      join("docs", "test-assets"),
      join("docs", "media")
    ]);
    expect(prepareScript).toContain("isPublishedDocumentation");

    const filtered = ["docs/media/editor-overview.png", "docs/test-assets/sample.png"];
    const kept = ["docs/mcp.md", "docs/project-model.md", "docs/getting-started.md"];

    // Real directories, because the filter canonicalizes `source` and a path
    // that does not exist on disk would fall back to `resolve()`. The repository
    // root itself is the natural fixture: it holds both excluded directories.
    for (const source of filtered) {
      expect(isPublishedDocumentation(repositoryRoot, join(repositoryRoot, source)), source).toBe(false);
    }
    for (const source of kept) {
      expect(isPublishedDocumentation(repositoryRoot, join(repositoryRoot, source)), source).toBe(true);
    }

    // The exclusions are path prefixes, not substrings. A sibling whose name
    // merely starts with an excluded one, or a `media` directory nested deeper
    // under docs/, is ordinary documentation and must still be published — a
    // substring test would drop all of it. These paths need not exist:
    // `canonical()` falls back to `resolve()`, which keeps the spelling.
    const publishable = [
      "docs/media-kit/logo-usage.md",
      "docs/mediaeval.md",
      "docs/test-assets-guide.md",
      "docs/guides/media/a.md"
    ];
    for (const source of publishable) {
      expect(isPublishedDocumentation(repositoryRoot, join(repositoryRoot, source)), source).toBe(true);
    }
    // The excluded directories themselves are refused, not just their contents.
    for (const source of ["docs/media", "docs/test-assets"]) {
      expect(isPublishedDocumentation(repositoryRoot, join(repositoryRoot, source)), source).toBe(false);
    }

    // The rule matches a repository-relative path, not a substring of the
    // absolute one: a checkout whose own path contains `docs/media` must still
    // publish its docs. `packages/pixel-cli` stands in for such a root.
    const nestedRoot = join(repositoryRoot, "packages", "pixel-cli");
    expect(isPublishedDocumentation(nestedRoot, join(repositoryRoot, "docs", "mcp.md"))).toBe(false);
    expect(isPublishedDocumentation(repositoryRoot, join(repositoryRoot, "docs"))).toBe(true);
    // The root itself is not documentation to copy.
    expect(isPublishedDocumentation(repositoryRoot, repositoryRoot)).toBe(false);
  });

  /**
   * Regression: Windows can spell one directory two ways — an 8.3 short name
   * (`RUNNER~1`), a junction, or a `subst` drive. `repositoryRoot` comes from
   * `import.meta.url`, which the ESM loader resolves through the real path,
   * while the directories handed to `fs.cp` are plain strings. When the two
   * spellings disagree, `relative()` returns a `../..`-escaping path, no
   * excluded prefix matches, and `docs/media` is published — which is exactly
   * how the media guard in package-install.mjs tripped on CI.
   *
   * Pinned with `path.win32` so the semantics are asserted on every platform
   * rather than only on a Windows runner.
   */
  it("refuses documentation whose path escapes the repository root", () => {
    const excluded = [win32.join("docs", "test-assets"), win32.join("docs", "media")];

    // The shipped rule restated on `path.win32`. `isPublishedDocumentation`
    // canonicalizes through the host filesystem, so Windows spellings cannot be
    // fed to it from a POSIX runner; the semantics under test are the
    // comparison that follows canonicalization, which is what is pinned here.
    const isCopied = (repositoryRoot: string, source: string): boolean => {
      const path = win32.relative(repositoryRoot, source);
      if (path.startsWith("..") || path === "") return false;
      return !excluded.some((directory) => path === directory || path.startsWith(directory + win32.sep));
    };

    const shortRoot = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\ep`;
    const longRoot = String.raw`C:\Users\runneradmin\AppData\Local\Temp\ep`;

    // Mixed spellings: `relative()` escapes the root, so the guard must refuse.
    expect(isCopied(shortRoot, win32.join(longRoot, "docs", "media", "editor.png"))).toBe(false);
    expect(isCopied(longRoot, win32.join(shortRoot, "docs", "media", "editor.png"))).toBe(false);
    // Refusing on escape must not silently drop real docs either — those are
    // only reachable once both sides agree, which canonicalization guarantees.
    expect(isCopied(shortRoot, win32.join(longRoot, "docs", "cli.md"))).toBe(false);

    // Matching spellings: the ordinary rules still apply on Windows separators.
    for (const root of [shortRoot, longRoot]) {
      expect(isCopied(root, win32.join(root, "docs", "media"))).toBe(false);
      expect(isCopied(root, win32.join(root, "docs", "media", "editor.png"))).toBe(false);
      expect(isCopied(root, win32.join(root, "docs", "test-assets", "sample.png"))).toBe(false);
      expect(isCopied(root, win32.join(root, "docs", "cli.md"))).toBe(true);
      expect(isCopied(root, win32.join(root, "docs"))).toBe(true);
      // `media` outside docs/ stays publishable.
      expect(isCopied(root, win32.join(root, "docs", "guides", "media", "a.md"))).toBe(true);
    }
  });

  it("uses local fonts without bundling webfonts or requesting remote stylesheets", () => {
    const webManifest = JSON.parse(read("apps/web/package.json")) as {
      dependencies: Record<string, string>;
    };

    expect(webManifest.dependencies).not.toHaveProperty("pretendard");
    expect(read("apps/web/src/main.tsx")).not.toContain("pretendard");

    const html = read("apps/web/index.html");
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/);

  });

  it("includes system UI fonts when Pretendard is not installed", () => {
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
