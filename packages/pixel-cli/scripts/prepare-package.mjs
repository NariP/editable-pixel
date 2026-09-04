import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
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

if (process.argv.includes("--clean")) {
  await Promise.all(generated.map((path) => rm(path, { recursive: true, force: true })));
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
 */
function isPublishedDocumentation(source) {
  const path = relative(repositoryRoot, source);
  return !excludedDocumentationDirectories.some(
    (directory) => path === directory || path.startsWith(directory + sep)
  );
}

const webDist = join(repositoryRoot, "apps/web/dist");
await access(join(webDist, "index.html"));
await mkdir(packageRoot, { recursive: true });
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
