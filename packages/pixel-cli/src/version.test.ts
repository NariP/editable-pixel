import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { packageVersion, resolveVersion } from "./version.js";

const canonical = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
    version: string;
  }
).version;

describe("CLI version resolution", () => {
  /**
   * The whole reason the build-time `define` needs a fallback: this test file
   * imports the source directly, so no substitution has happened. If the
   * fallback ever regresses, `--version` under vitest and `pnpm dev` reports
   * `undefined` while the shipped bundle still looks correct.
   */
  it("resolves the canonical version when nothing was injected", () => {
    expect(packageVersion).toBe(canonical);
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("never yields undefined or an empty string for a missing injection", () => {
    for (const missing of [undefined, ""]) {
      const resolved = resolveVersion(missing);

      expect(resolved).toBeTypeOf("string");
      expect(resolved).not.toBe("");
      expect(resolved).toBe(canonical);
    }
  });

  it("prefers an injected value over the disk fallback", () => {
    expect(resolveVersion("9.9.9")).toBe("9.9.9");
  });
});
