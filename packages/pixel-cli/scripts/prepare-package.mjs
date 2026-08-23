import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const generated = [
  join(packageRoot, "web"),
  join(packageRoot, "README.md"),
  join(packageRoot, "README.ko.md"),
  join(packageRoot, "LICENSE")
];

if (process.argv.includes("--clean")) {
  await Promise.all(generated.map((path) => rm(path, { recursive: true, force: true })));
  process.exit(0);
}

const webDist = join(repositoryRoot, "apps/web/dist");
await access(join(webDist, "index.html"));
await mkdir(packageRoot, { recursive: true });
await cp(webDist, join(packageRoot, "web"), { recursive: true, force: true });
await cp(join(repositoryRoot, "README.md"), join(packageRoot, "README.md"));
await cp(join(repositoryRoot, "README.ko.md"), join(packageRoot, "README.ko.md"));
await cp(join(repositoryRoot, "LICENSE"), join(packageRoot, "LICENSE"));
