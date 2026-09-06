import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalManifestPath,
  updateManifestVersion,
  versionedManifests
} from "./manifest-versions.mjs";

/**
 * Propagates the canonical version in `packages/pixel-cli/package.json` to the
 * host plugin manifests. Run it after bumping that one field; the two source
 * surfaces (`--version`, MCP handshake) need no step because tsup injects them.
 *
 * There is deliberately no `--check` mode. Drift is already a `pnpm test`
 * failure — `tests/manifests/plugin-manifests.test.ts` asserts all three of
 * these manifests against the canonical value — so a second verify-time gate
 * would only add an unused flag to keep in step with the rewrite rule.
 */
const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const { version } = JSON.parse(await readFile(join(repositoryRoot, canonicalManifestPath), "utf8"));
if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`${canonicalManifestPath}: no usable version`);
}

const synced = [];
for (const { path, keyPath } of versionedManifests) {
  const absolute = join(repositoryRoot, path);
  const source = await readFile(absolute, "utf8");
  const updated = updateManifestVersion(source, keyPath, version, path);
  if (updated === null) continue;
  synced.push(path);
  await writeFile(absolute, updated);
}

process.stdout.write(
  synced.length === 0
    ? `All host manifests already at ${version}.\n`
    : `Synced to ${version}: ${synced.join(", ")}\n`
);
