import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonical, isPublishedDocumentation } from "./published-documentation.mjs";

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
  filter: (source) => isPublishedDocumentation(repositoryRoot, source),
  force: true
});
await cp(join(repositoryRoot, "skills", "editable-pixel"), join(packageRoot, "skills", "editable-pixel"), {
  recursive: true,
  force: true
});
