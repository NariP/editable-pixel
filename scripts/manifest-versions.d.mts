/**
 * Types for the plain-JavaScript version-sync helper. The script it serves runs
 * under bare `node`, so the implementation stays `.mjs`; this declaration is what
 * lets the manifest test suite import the real rewrite under `strict` rather than
 * fall back to `any`.
 */

/** A key/index path from a JSON document root down to a version string. */
export type VersionKeyPath = (string | number)[];

/** Host manifests that must follow the canonical version, and where each keeps it. */
export declare const versionedManifests: { path: string; keyPath: VersionKeyPath }[];

/** Repository-relative path of the manifest every other version follows. */
export declare const canonicalManifestPath: string;

/** Reads the version at `keyPath`, throwing when the slot is missing or not a string. */
export declare function readVersionAt(document: unknown, keyPath: VersionKeyPath, path: string): string;

/**
 * Returns `source` with the version at `keyPath` rewritten to `version`, or
 * `null` when it already matches. Throws when the slot cannot be located
 * unambiguously.
 */
export declare function updateManifestVersion(
  source: string,
  keyPath: VersionKeyPath,
  version: string,
  path: string
): string | null;
