import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { packageVersion, resolveVersion } from "./version.js";

const canonical = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../pixel-cli/package.json", import.meta.url)), "utf8")
  ) as { version: string }
).version;

describe("MCP server version resolution", () => {
  /**
   * Imported as source here, so tsup's `define` has not run. The handshake must
   * still report the published CLI version rather than this private package's
   * pinned `0.0.0` or an `undefined` that fails opaquely on the client.
   */
  it("resolves the canonical CLI version when nothing was injected", () => {
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
