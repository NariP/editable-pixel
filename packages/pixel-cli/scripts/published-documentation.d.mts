/**
 * Types for the plain-JavaScript packaging helper. The script it serves runs
 * under bare `node` during prepack, so the implementation stays `.mjs`; this
 * declaration is what lets the distribution suite import the real filter under
 * `strict` rather than fall back to `any`.
 */

/** Resolves a path through its real spelling, falling back to `resolve()`. */
export declare const canonical: (path: string) => string;

/** Repository-relative directories kept out of the published archive. */
export declare const excludedDocumentationDirectories: string[];

/**
 * `fs.cp` filter deciding whether `source` belongs in the published docs tree.
 * Paths outside `repositoryRoot`, and the root itself, are refused.
 */
export declare function isPublishedDocumentation(repositoryRoot: string, source: string): boolean;
