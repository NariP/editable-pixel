import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalManifestPath,
  readVersionAt,
  updateManifestVersion,
  versionedManifests
} from "../../scripts/manifest-versions.mjs";

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * Copies only the files the script touches into a scratch checkout. The script
 * writes, so pointing it at the real repository would leave the working tree
 * dirty when a test fails partway through.
 */
const scratchCheckout = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "editable-pixel-sync-"));
  temporaryDirectories.push(root);
  for (const relative of [canonicalManifestPath, ...versionedManifests.map(({ path }) => path)]) {
    const destination = join(root, relative);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repositoryRoot, relative), destination);
  }
  await cp(join(repositoryRoot, "scripts"), join(root, "scripts"), { recursive: true, force: true });
  return root;
};

const versionsIn = async (root: string): Promise<string[]> =>
  Promise.all(
    versionedManifests.map(async ({ path, keyPath }) =>
      readVersionAt(JSON.parse(await readFile(join(root, path), "utf8")), keyPath, path)
    )
  );

describe("version sync script", () => {
  it("rewrites every host manifest to the canonical version", async () => {
    const root = await scratchCheckout();
    const canonical = join(root, canonicalManifestPath);
    const manifest = JSON.parse(await readFile(canonical, "utf8")) as { version: string };
    const bumped = "9.9.9";
    expect(manifest.version).not.toBe(bumped);
    await writeFile(canonical, JSON.stringify({ ...manifest, version: bumped }, null, 2));

    await run(process.execPath, [join(root, "scripts/sync-version.mjs")], { cwd: root });

    expect(await versionsIn(root)).toEqual(versionedManifests.map(() => bumped));
  });

  it("is idempotent and reports no drift on a second run", async () => {
    const root = await scratchCheckout();
    const { stdout } = await run(process.execPath, [join(root, "scripts/sync-version.mjs")], { cwd: root });

    expect(stdout).toContain("already at");
  });

  it("preserves the hand-kept manifest formatting outside the version field", async () => {
    const root = await scratchCheckout();
    const path = versionedManifests[0]!.path;
    const before = await readFile(join(root, path), "utf8");
    const canonical = join(root, canonicalManifestPath);
    const manifest = JSON.parse(await readFile(canonical, "utf8")) as { version: string };
    await writeFile(canonical, JSON.stringify({ ...manifest, version: "9.9.9" }, null, 2));

    await run(process.execPath, [join(root, "scripts/sync-version.mjs")], { cwd: root });

    const after = await readFile(join(root, path), "utf8");
    // A re-serialized manifest would reflow `keywords` and `author` onto many
    // lines, turning a one-field bump into an unreviewable diff.
    expect(after).toBe(before.replace(`"${manifest.version}"`, '"9.9.9"'));
  });

  it("refuses to rewrite a manifest whose version slot moved", () => {
    expect(() => updateManifestVersion('{"name":"x"}', ["version"], "9.9.9", "fixture.json")).toThrow(
      /no version string/
    );
    expect(() =>
      updateManifestVersion('{"plugins":[]}', ["plugins", 0, "version"], "9.9.9", "fixture.json")
    ).toThrow(/no version/);
  });
});
