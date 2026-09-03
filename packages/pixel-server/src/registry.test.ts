import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registryPath } from "./registry.js";

const originalRegistry = process.env.EDITABLE_PIXEL_REGISTRY;
const originalTmpdir = process.env.TMPDIR;

afterEach(() => {
  if (originalRegistry === undefined) delete process.env.EDITABLE_PIXEL_REGISTRY;
  else process.env.EDITABLE_PIXEL_REGISTRY = originalRegistry;
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
});

describe("server registry", () => {
  it("uses a stable per-user path when MCP hosts sanitize TMPDIR", () => {
    delete process.env.EDITABLE_PIXEL_REGISTRY;
    process.env.TMPDIR = "/tmp/one-host";
    const first = registryPath();
    process.env.TMPDIR = "/tmp/another-host";
    expect(registryPath()).toBe(first);
    expect(first).toBe(join(homedir(), ".editable-pixel", "server.json"));
  });

  it("allows isolated tests and managed hosts to override the path", () => {
    process.env.EDITABLE_PIXEL_REGISTRY = "/tmp/editable-pixel-managed.json";
    expect(registryPath()).toBe("/tmp/editable-pixel-managed.json");
  });
});
