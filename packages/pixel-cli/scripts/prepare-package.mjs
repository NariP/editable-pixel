import { realpathSync } from "node:fs";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonicalize before any path comparison. `import.meta.url` is resolved through
 * the real path by the ESM loader, but the directories we hand to `fs.cp` are
 * plain strings — on Windows a checkout reached through an 8.3 short name
 * (`RUNNER~1`), a junction, or a `subst` drive spells the same directory two
 * ways. `relative()` between two spellings returns a `../..`-escaping path, and
 * every `startsWith` guard built on it silently passes. Comparing canonical
 * paths on both sides removes that whole class of mismatch.
 */
const canonical = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

const packageRoot = canonical(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const repositoryRoot = canonical(resolve(packageRoot, "../.."));
const generated = [
  join(packageRoot, "web"),
  join(packageRoot, "README.md"),
  join(packageRoot, "README.ko.md"),
  join(packageRoot, "CONTRIBUTING.md"),
  join(packageRoot, "LICENSE"),
  join(packageRoot, "install.sh"),
  join(packageRoot, "docs"),
  join(packageRoot, "skills")
];

const clean = () => Promise.all(generated.map((path) => rm(path, { recursive: true, force: true })));

if (process.argv.includes("--clean")) {
  await clean();
  process.exit(0);
}

const excludedDocumentationDirectories = [join("docs", "test-assets"), join("docs", "media")];

/**
 * Excluded from the published package: test-assets are fixtures, media are
 * README screenshots that npm rewrites to GitHub raw URLs anyway.
 *
 * Matched on the repository-relative path rather than as a substring of the
 * absolute one, so a checkout living under a path that itself contains
 * `docs/media` does not drop every file.
 *
 * `source` is canonicalized to match `repositoryRoot`; a path that still lands
 * outside the repository afterwards is refused rather than published, so a
 * spelling we failed to normalize can never leak media into the archive.
 */
function isPublishedDocumentation(source) {
  const path = relative(repositoryRoot, canonical(source));
  if (path.startsWith("..") || path === "") return false;
  return !excludedDocumentationDirectories.some(
    (directory) => path === directory || path.startsWith(directory + sep)
  );
}

const webDist = join(repositoryRoot, "apps/web/dist");
await access(join(webDist, "index.html"));
await mkdir(packageRoot, { recursive: true });
/**
 * `cp` merges into an existing destination — `force` overwrites collisions but
 * never deletes what the current sources no longer produce. Without this the
 * build is not idempotent: anything a previous build left behind (a filter that
 * used to copy `docs/media`, an asset since deleted) stays on disk, and the
 * `files` allowlist packs it. `postpack --clean` only runs after the archive is
 * already sealed, so the destination has to be authoritative here.
 */
await clean();
await cp(webDist, join(packageRoot, "web"), { recursive: true, force: true });
await cp(join(repositoryRoot, "README.md"), join(packageRoot, "README.md"));
await cp(join(repositoryRoot, "README.ko.md"), join(packageRoot, "README.ko.md"));
await cp(join(repositoryRoot, "CONTRIBUTING.md"), join(packageRoot, "CONTRIBUTING.md"));
await cp(join(repositoryRoot, "LICENSE"), join(packageRoot, "LICENSE"));
await cp(join(repositoryRoot, "install.sh"), join(packageRoot, "install.sh"));
await cp(join(repositoryRoot, "docs"), join(packageRoot, "docs"), {
  recursive: true,
  filter: isPublishedDocumentation,
  force: true
});
await cp(join(repositoryRoot, "skills", "editable-pixel"), join(packageRoot, "skills", "editable-pixel"), {
  recursive: true,
  force: true
});
