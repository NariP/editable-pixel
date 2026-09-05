import { realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * Side-effect free half of prepare-package.mjs. The script itself copies at
 * module scope, so importing it to test the filter would run a build; keeping
 * the rule here lets tests call the real function instead of mirroring it.
 */

/**
 * Canonicalize before any path comparison. `import.meta.url` is resolved through
 * the real path by the ESM loader, but the directories we hand to `fs.cp` are
 * plain strings — on Windows a checkout reached through an 8.3 short name
 * (`RUNNER~1`), a junction, or a `subst` drive spells the same directory two
 * ways. `relative()` between two spellings returns a `../..`-escaping path, and
 * every `startsWith` guard built on it silently passes. Comparing canonical
 * paths on both sides removes that whole class of mismatch.
 */
export const canonical = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

export const excludedDocumentationDirectories = [join("docs", "test-assets"), join("docs", "media")];

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
 *
 * `repositoryRoot` is a parameter so tests can point the rule at a fixture
 * checkout; the script always passes the root it derived from its own location.
 */
export function isPublishedDocumentation(repositoryRoot, source) {
  const path = relative(repositoryRoot, canonical(source));
  if (path.startsWith("..") || path === "") return false;
  return !excludedDocumentationDirectories.some(
    (directory) => path === directory || path.startsWith(directory + sep)
  );
}
