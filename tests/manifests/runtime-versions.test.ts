import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(join(repositoryRoot, relativePath), "utf8");

const readManifest = (relativePath: string): unknown => JSON.parse(readSource(relativePath));

/**
 * Strips `#` comment lines so assertions match executable content only. Without
 * this a comment *explaining* a rule ("corepack must run before setup-node")
 * satisfies the check that enforces it, and the guard silently stops guarding.
 */
const withoutComments = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const enginesNodeAt = (relativePath: string): string => {
  const { engines } = readManifest(relativePath) as { engines?: { node?: string } };
  const declared = engines?.node;

  // A missing declaration would otherwise make every comparison below vacuously
  // pass by matching `undefined` against `undefined`.
  expect(declared, `${relativePath}: no engines.node declaration`).toBeTypeOf("string");
  return declared as string;
};

/**
 * The supported runtime floor used to be restated in nine places with nothing
 * reading any of them back: two `engines` fields, two workflow `node-version`
 * pins, the tsup `target`, three prose mentions, and `install.sh`'s own parsing
 * gate. They drifted into an outright lie — `commander@15` needs `>=22.12.0`
 * while every one of those sites still advertised 20.9.
 *
 * The floor now has one canonical statement: `engines.node` on the published CLI
 * package. Every other site is checked against *that value as read from disk*,
 * never against a literal repeated in this file, so a bump in one place without
 * the others fails here instead of shipping.
 *
 * `.nvmrc` is the canonical *development/CI* runtime and is deliberately a
 * different kind of statement: the floor is the minimum a user may run, while
 * `.nvmrc` is the single concrete version the project builds and tests on. They
 * are required to be consistent (the tested version must satisfy the advertised
 * floor), not identical.
 */
const canonicalManifest = "packages/pixel-cli/package.json";

const majorOf = (version: string): number => {
  const major = Number(version.split(".")[0]);
  expect(Number.isInteger(major), `unparseable major in "${version}"`).toBe(true);
  return major;
};

/**
 * Extracts `24` from a `>=24.0.0` style floor, failing loudly on any other shape.
 *
 * A non-zero minor or patch is rejected rather than truncated. Everything
 * downstream — `install.sh`'s gate, the tsup target, the prose in the docs —
 * can only express a whole major, so a floor of `>=24.5.0` would leave
 * `major < 24` in place and quietly admit Node 24.0–24.4: the exact drift this
 * file exists to prevent, reintroduced by a single bump. Widening the floor
 * below the major granularity therefore has to widen those sites first.
 */
const floorMajor = (range: string): number => {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());

  expect(match, `engines.node "${range}" is not a plain ">=x.y.z" floor`).not.toBeNull();

  const [, major, minor, patch] = match as RegExpExecArray;

  expect(
    `${minor}.${patch}`,
    `engines.node "${range}": install.sh only encodes the major, so a floor above ` +
      `${major}.0.0 is unenforceable — widen the gate (and the docs) before moving it`
  ).toBe("0.0");

  return Number(major);
};

describe("runtime version single source", () => {
  it("keeps the .nvmrc major consistent with the engines floor", () => {
    const nvmrc = readSource(".nvmrc");

    // A bare major (no patch pin) is the deliberate choice: setup-node and nvm
    // both resolve it to the newest 24.x, so security patches land without a PR
    // per release. Reproducibility is anchored by pnpm-lock.yaml instead.
    expect(nvmrc.trimEnd(), ".nvmrc").toMatch(/^\d+$/);
    // Trailing newline, no leading whitespace: nvm reads the file verbatim.
    expect(nvmrc, ".nvmrc must end with exactly one newline").toBe(`${nvmrc.trim()}\n`);

    const tested = majorOf(nvmrc.trim());
    const floor = floorMajor(enginesNodeAt(canonicalManifest));

    // The version CI actually runs must satisfy the floor advertised to users.
    // Testing below the floor would leave the supported range unexercised.
    expect(tested, `.nvmrc (${tested}) is below the engines floor (${floor})`)
      .toBeGreaterThanOrEqual(floor);
  });

  it.each([".github/workflows/ci.yml", ".github/workflows/release.yml"])(
    "reads the Node version from .nvmrc instead of hardcoding it in %s",
    (workflow) => {
      const source = withoutComments(readSource(workflow));

      expect(source, workflow).toContain("node-version-file: .nvmrc");
      // `node-version:` is the hardcoding this replaces. Matching the key rather
      // than a specific number catches a reintroduced pin at any value.
      expect(/^\s*node-version:/m.test(source), `${workflow}: hardcodes node-version`).toBe(false);
    }
  );

  it.each([".github/workflows/ci.yml", ".github/workflows/release.yml"])(
    "resolves pnpm through Corepack from the packageManager field in %s",
    (workflow) => {
      const source = withoutComments(readSource(workflow));
      const { packageManager } = readManifest("package.json") as { packageManager?: string };

      expect(packageManager, "package.json: no packageManager field").toMatch(/^pnpm@\d+\.\d+\.\d+$/);
      // Scoped to pnpm on purpose. Bare `corepack enable` also shims npm, and
      // that shim aborts inside a repository whose `packageManager` is pnpm,
      // which breaks the `npm install --global` install.sh performs under
      // test:distribution. Asserting the exact form keeps that regression out.
      expect(source, workflow).toContain("corepack enable pnpm");
      expect(
        /corepack enable\s*$/m.test(source),
        `${workflow}: bare \`corepack enable\` also shims npm and breaks install.sh`
      ).toBe(false);
      // pnpm/action-setup takes its own `version:` input, which is the second
      // source of truth this removes.
      expect(source.includes("pnpm/action-setup"), `${workflow}: still pins pnpm separately`).toBe(false);

      // Corepack must be on PATH before setup-node, whose `cache: pnpm` shells
      // out to `pnpm store path`. Reversing these silently breaks the cache.
      const corepackAt = source.indexOf("corepack enable pnpm");
      const setupNodeAt = source.indexOf("actions/setup-node");
      expect(setupNodeAt, `${workflow}: no setup-node step`).toBeGreaterThan(-1);
      expect(corepackAt, `${workflow}: corepack must be enabled before setup-node`)
        .toBeLessThan(setupNodeAt);
    }
  );

  it("declares the same engines floor in the workspace root and the CLI package", () => {
    // Both sides are read from disk; neither is compared against a literal here,
    // so changing only one fails regardless of which one moved.
    expect(enginesNodeAt("package.json")).toBe(enginesNodeAt(canonicalManifest));
  });

  it("gates install.sh on the same major as the engines floor", () => {
    const source = withoutComments(readSource("install.sh"));
    const floor = floorMajor(enginesNodeAt(canonicalManifest));

    // The gate is an inline node script. Asserting on the parsed comparison
    // rather than on the prose is the point: the previous floor bump changed the
    // message and left `major < 20` behind, which passes silently on any
    // still-unsupported runtime.
    const gate = /if \(major < (\d+)\) process\.exit\(1\);/.exec(source);
    expect(gate, "install.sh: no recognizable `major < N` version gate").not.toBeNull();
    expect(Number((gate as RegExpExecArray)[1]), "install.sh gate major").toBe(floor);

    // A leftover minor term would mean the gate encodes a floor the regex above
    // cannot see, e.g. `major === 20 && minor < 9`.
    expect(/minor/.test(source), "install.sh: stale minor comparison in the gate").toBe(false);

    // Both operator messages must quote the same major they enforce.
    const advertised = [...source.matchAll(/requires Node\.js (\d+)(?:\.\d+)? or newer/g)];
    expect(advertised.length, "install.sh: expected both Node requirement messages").toBe(2);
    for (const [text, major] of advertised) {
      expect(Number(major), `install.sh: "${text}" disagrees with the gate`).toBe(floor);
    }
  });

  it("targets the supported major when bundling the CLI", () => {
    const floor = floorMajor(enginesNodeAt(canonicalManifest));
    const target = /target:\s*"node(\d+)"/.exec(readSource("packages/pixel-cli/tsup.config.ts"));

    expect(target, "tsup.config.ts: no node target").not.toBeNull();
    // Downleveling below the floor is harmless but pointless; emitting above it
    // ships syntax the advertised floor cannot parse.
    expect(Number((target as RegExpExecArray)[1]), "tsup target").toBe(floor);
  });

  it("advertises the supported major consistently across user-facing docs", () => {
    const floor = floorMajor(enginesNodeAt(canonicalManifest));
    const mentions = [
      { file: "README.md", pattern: /Node\.js (\d+)\+/ },
      { file: "README.ko.md", pattern: /Node\.js (\d+) 이상/ },
      { file: "docs/getting-started.md", pattern: /Node\.js (\d+) or newer/ },
      { file: "CONTRIBUTING.md", pattern: /Node\.js (\d+) or newer/ }
    ] as const;

    for (const { file, pattern } of mentions) {
      const match = pattern.exec(readSource(file));

      expect(match, `${file}: no Node requirement matching ${String(pattern)}`).not.toBeNull();
      expect(Number((match as RegExpExecArray)[1]), `${file}: advertised Node major`).toBe(floor);
    }
  });

  it("advertises the packageManager pnpm version consistently across user-facing docs", () => {
    // Same drift shape as the Node floor, one field over: `packageManager` became
    // CI's single source, but the docs still spelled the version out by hand and
    // nothing read them back. Parsed from disk on both sides.
    const { packageManager } = readManifest("package.json") as { packageManager?: string };
    const canonical = /^pnpm@(\d+\.\d+\.\d+)$/.exec(String(packageManager));

    expect(canonical, `package.json: packageManager "${packageManager}" is not "pnpm@x.y.z"`)
      .not.toBeNull();

    const version = (canonical as RegExpExecArray)[1];

    for (const file of ["CONTRIBUTING.md", "README.md", "README.ko.md"]) {
      const mentioned = [...readSource(file).matchAll(/pnpm (\d+\.\d+\.\d+)/g)].map(
        ([, found]) => found
      );

      expect(mentioned.length, `${file}: no "pnpm x.y.z" mention to check`).toBeGreaterThan(0);
      for (const found of mentioned) {
        expect(found, `${file}: documents pnpm ${found}, packageManager is ${version}`).toBe(
          version
        );
      }
    }
  });
});

/**
 * The three `actions/*` pins were the values the repository was created with and
 * had never moved, which is the same silent-drift shape as the runtime floor
 * above — except an action pin fails *outward*, on infrastructure the tests
 * cannot otherwise reach.
 *
 * It was not cosmetic. On `actions/setup-node@v4` this repository's Windows job
 * failed outright: Corepack writes its shims beside the *current* node, so they
 * landed in the runner's preinstalled Node directory, and a Windows `.cmd` shim
 * is early-bound to the `node.exe` next to it (a Linux shim goes through
 * `#!/usr/bin/env node` and so late-binds, which is why only Windows broke).
 * `pnpm` therefore ran on Node 22 while `.nvmrc` asked for 24, and the build
 * died on `Unsupported engine: wanted >=24.0.0`. See actions/setup-node#531.
 *
 * The floor is expressed as a minimum rather than an exact pin: a newer major
 * released upstream should not turn this suite red, but slipping back below the
 * version that fixes the Windows break must.
 */
const MINIMUM_ACTION_MAJORS: Readonly<Record<string, number>> = {
  "actions/checkout": 7,
  "actions/setup-node": 7,
  "actions/upload-artifact": 7
};

describe("GitHub Action versions", () => {
  const workflows = [".github/workflows/ci.yml", ".github/workflows/release.yml"] as const;

  it.each(workflows)("pins every action to a supported major in %s", (workflow) => {
    const source = withoutComments(readSource(workflow));
    const used = [...source.matchAll(/^\s*-?\s*uses:\s*(\S+?)@(\S+)\s*$/gm)];

    // Without this the whole assertion loop would pass by iterating zero times
    // if the `uses:` shape ever changed.
    expect(used.length, `${workflow}: no \`uses:\` steps found`).toBeGreaterThan(0);

    for (const [, action, ref] of used) {
      const minimum = MINIMUM_ACTION_MAJORS[action as string];

      // An unknown action is a deliberate failure, not a skip: a new action
      // added without a floor here would otherwise never be version-checked.
      // Thrown rather than `expect`ed so the check also narrows the type for the
      // comparison below, instead of asserting and then casting the doubt away.
      if (minimum === undefined) {
        throw new Error(`${workflow}: no known-good major recorded for ${action}`);
      }

      const pinned = /^v(\d+)/.exec(ref as string);
      expect(pinned, `${workflow}: ${action} is pinned to "${ref}", not a vN tag`).not.toBeNull();

      expect(
        Number((pinned as RegExpExecArray)[1]),
        `${workflow}: ${action}@${ref} is below v${minimum}; on setup-node v4 the ` +
          `Corepack shim bound to the runner's default Node and broke the Windows job`
      ).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("checks every action that either workflow actually uses", () => {
    // Guards the table itself: an entry that no workflow references is dead
    // weight, and — more importantly — proves the assertion above is reached for
    // all three actions rather than silently covering only the ones in one file.
    const referenced = new Set(
      workflows.flatMap((workflow) =>
        [...withoutComments(readSource(workflow)).matchAll(/uses:\s*(\S+?)@/g)].map(
          ([, action]) => action as string
        )
      )
    );

    expect([...referenced].sort()).toEqual(Object.keys(MINIMUM_ACTION_MAJORS).sort());
  });
});
