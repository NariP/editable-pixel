import { execFile as execFileCallback } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Runs the real `prepare-package.mjs` against a synthetic checkout instead of
 * the workspace. The script derives both roots from its own location, so a
 * fixture repository exercises the shipped logic without a tsup/vite build and
 * without racing the workspace copy other suites read.
 */
let checkout: string;
let packageRoot: string;

const prepare = async (...argv: string[]): Promise<void> => {
  await execFile(process.execPath, [join(packageRoot, "scripts", "prepare-package.mjs"), ...argv]);
};

const exists = async (...segments: string[]): Promise<boolean> =>
  access(join(packageRoot, ...segments)).then(() => true, () => false);

beforeEach(async () => {
  // `os.tmpdir()` can hand back a non-canonical spelling of the directory —
  // `/var` for `/private/var` on macOS, an 8.3 short name (`RUNNER~1`) on
  // Windows. The script canonicalizes the roots it derives from
  // `import.meta.url`, so the fixture has to be canonical too or the paths this
  // test asserts on name a different spelling than the ones the build wrote.
  checkout = realpathSync.native(await mkdtemp(join(tmpdir(), "editable-pixel-prepare-")));
  packageRoot = join(checkout, "packages", "pixel-cli");

  await mkdir(join(packageRoot, "scripts"), { recursive: true });
  await cp(
    join(repositoryRoot, "packages/pixel-cli/scripts/prepare-package.mjs"),
    join(packageRoot, "scripts", "prepare-package.mjs")
  );

  await mkdir(join(checkout, "apps", "web", "dist", "assets"), { recursive: true });
  await writeFile(join(checkout, "apps/web/dist/index.html"), "<div id=\"root\"></div>");
  await writeFile(join(checkout, "apps/web/dist/assets/index.js"), "export {};");

  await mkdir(join(checkout, "docs", "media"), { recursive: true });
  await mkdir(join(checkout, "docs", "test-assets"), { recursive: true });
  await writeFile(join(checkout, "docs/cli.md"), "# cli");
  await writeFile(join(checkout, "docs/media/editor-overview.png"), "png");
  await writeFile(join(checkout, "docs/test-assets/sample.png"), "png");

  await mkdir(join(checkout, "skills", "editable-pixel", "references"), { recursive: true });
  await writeFile(join(checkout, "skills/editable-pixel/SKILL.md"), "# skill");
  await writeFile(join(checkout, "skills/editable-pixel/references/cli.md"), "# reference");

  for (const file of ["README.md", "README.ko.md", "CONTRIBUTING.md", "LICENSE", "install.sh"]) {
    await writeFile(join(checkout, file), file);
  }
});

afterEach(async () => {
  await rm(checkout, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("prepare-package assembles the publishable tree", () => {
  it("copies the offline docs and skill while dropping media and test fixtures", async () => {
    await prepare();

    expect(await exists("web", "index.html")).toBe(true);
    expect(await exists("docs", "cli.md")).toBe(true);
    expect(await exists("skills", "editable-pixel", "SKILL.md")).toBe(true);
    expect(await exists("README.md")).toBe(true);

    expect(await exists("docs", "media")).toBe(false);
    expect(await exists("docs", "test-assets")).toBe(false);
  });

  /**
   * Regression: `cp` merges into its destination, so leftovers from an earlier
   * build survived every later one and the `files` allowlist packed them —
   * which is how `docs/media` reached the archive and tripped the slimming
   * guard in package-install.mjs on CI. `postpack --clean` cannot save us here
   * because it runs only after the tarball is sealed.
   */
  it("discards artifacts a previous build left behind", async () => {
    await mkdir(join(packageRoot, "docs", "media"), { recursive: true });
    await mkdir(join(packageRoot, "web", "stale"), { recursive: true });
    await mkdir(join(packageRoot, "skills", "editable-pixel", "references"), { recursive: true });
    await writeFile(join(packageRoot, "docs/media/editor-overview.png"), "stale");
    await writeFile(join(packageRoot, "docs/removed-guide.md"), "stale");
    await writeFile(join(packageRoot, "web/stale/legacy.js"), "stale");
    await writeFile(join(packageRoot, "skills/editable-pixel/references/removed.md"), "stale");

    await prepare();

    expect(await exists("docs", "media")).toBe(false);
    expect(await exists("docs", "removed-guide.md")).toBe(false);
    expect(await exists("web", "stale")).toBe(false);
    expect(await exists("skills", "editable-pixel", "references", "removed.md")).toBe(false);

    // The current sources still land, so the reset is not over-broad.
    expect(await exists("docs", "cli.md")).toBe(true);
    expect(await exists("web", "index.html")).toBe(true);
    expect(await exists("skills", "editable-pixel", "references", "cli.md")).toBe(true);
  });

  it("removes every generated path with --clean", async () => {
    await prepare();
    await prepare("--clean");

    for (const generated of ["web", "docs", "skills", "README.md", "README.ko.md", "CONTRIBUTING.md", "LICENSE", "install.sh"]) {
      expect(await exists(generated), generated).toBe(false);
    }
  });

  it("is idempotent across repeated builds", async () => {
    await prepare();
    await prepare();

    expect(await exists("docs", "cli.md")).toBe(true);
    expect(await exists("docs", "media")).toBe(false);
  });
});
