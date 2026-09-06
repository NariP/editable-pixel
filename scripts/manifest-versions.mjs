/**
 * Side-effect free half of `sync-version.mjs`. The runner writes files at module
 * scope, so importing it to test the rewrite would mutate the checkout; keeping
 * the rule here lets tests call the real function against fixture text instead
 * of mirroring it.
 *
 * The version is canonical in `packages/pixel-cli/package.json`. The two shipped
 * source surfaces (`--version`, MCP `serverInfo.version`) are injected at build
 * time by tsup, so the only places left to keep in step are these three host
 * manifests, which are plain JSON with no build step to read the canonical value.
 */

/**
 * Where each host manifest keeps its version, as a path of object keys and array
 * indices from the document root. Declaring the location rather than
 * search-and-replacing a semver-shaped string matters: `marketplace.json` nests
 * its version inside `plugins[0]`, and a blind replace would also rewrite any
 * unrelated pinned version that happens to share the shape.
 */
export const versionedManifests = [
  { path: ".claude-plugin/plugin.json", keyPath: ["version"] },
  { path: ".claude-plugin/marketplace.json", keyPath: ["plugins", 0, "version"] },
  { path: ".codex-plugin/plugin.json", keyPath: ["version"] }
];

/** The canonical manifest every other version follows. */
export const canonicalManifestPath = "packages/pixel-cli/package.json";

const describe = (keyPath) => keyPath.map((key) => (typeof key === "number" ? `[${key}]` : key)).join(".");

/**
 * Reads the value at `keyPath`, refusing a missing or non-string slot rather
 * than reporting a no-op update. A manifest that got restructured must fail the
 * sync loudly; silently leaving it stale is exactly the failure mode this whole
 * script exists to remove.
 */
export function readVersionAt(document, keyPath, path) {
  let node = document;
  for (const key of keyPath) {
    if (node === null || typeof node !== "object") {
      throw new Error(`${path}: no version at ${describe(keyPath)}`);
    }
    node = node[key];
  }
  if (typeof node !== "string") throw new Error(`${path}: no version string at ${describe(keyPath)}`);
  return node;
}

/**
 * Rewrites the version in `source` by editing the text rather than
 * `JSON.stringify`-ing a parsed document. Re-serializing would reformat every
 * manifest — these use a hand-kept single-line style for `keywords`, `author`,
 * and `owner` that a formatter does not reproduce — turning a one-field bump
 * into an unreviewable diff.
 *
 * The old value is located by parsing first, then replaced at its own key so an
 * identical string elsewhere in the file cannot be hit. Returns `null` when the
 * file already holds `version`, letting the caller skip the write and stay
 * idempotent.
 */
export function updateManifestVersion(source, keyPath, version, path) {
  const current = readVersionAt(JSON.parse(source), keyPath, path);
  if (current === version) return null;

  const key = keyPath[keyPath.length - 1];
  const pattern = new RegExp(`("${key}"\\s*:\\s*)"${current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${path}: expected exactly one "${key}": "${current}" to rewrite, found ${matches.length}`);
  }
  return source.replace(pattern, `$1${JSON.stringify(version)}`);
}
