import assert from "node:assert/strict";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { execFile } from "./process.mjs";

export async function verifyHostRegistration({ cli, entrypoint, temporary, environment }) {
  const home = join(temporary, "test home");
  const fixture = join(temporary, "host fixture");
  const prefix = join(temporary, "host commands (test)");
  await mkdir(fixture);
  await mkdir(home);
  await cp(resolve("tests/distribution/fixtures/host.mjs"), join(fixture, "host.mjs"));
  await writeFile(join(fixture, "package.json"), JSON.stringify({
    name: "editable-pixel-test-host", version: "1.0.0", type: "module",
    bin: { codex: "host.mjs", claude: "host.mjs" }
  }));
  await execFile("npm", ["install", "--global", "--ignore-scripts", "--prefix", prefix, fixture], { env: environment });
  const bin = process.platform === "win32" ? prefix : join(prefix, "bin");
  const log = join(temporary, "host-calls.jsonl");
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const env = {
    ...environment, [pathKey]: `${bin}${delimiter}${environment[pathKey] ?? ""}`,
    HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"), EDITABLE_PIXEL_TEST_HOST_LOG: log
  };
  const mcp = await realpath(entrypoint);
  const run = async (extraEnv = {}, force = false) => {
    await writeFile(log, "");
    const result = await execFile(cli, ["--json", "install-skill", "--host", "both", ...(force ? ["--force"] : [])], {
      env: { ...env, ...extraEnv }
    });
    return { output: JSON.parse(result.stdout), calls: (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)) };
  };
  const registered = await run();
  assert.deepEqual(registered.output.registrations.map(({ status }) => status), ["registered", "registered"]);
  assert.deepEqual(registered.calls, [
    ["--version"], ["--version"],
    ["mcp", "get", "editable-pixel"], ["mcp", "add", "editable-pixel", "--", process.execPath, mcp],
    ["mcp", "get", "editable-pixel"], ["mcp", "add", "--scope", "user", "editable-pixel", "--", process.execPath, mcp]
  ]);
  // Remove only fixture Skill copies so we can exercise preserved registrations.
  await rm(join(home, ".codex", "skills"), { recursive: true });
  await rm(join(home, ".claude", "skills"), { recursive: true });
  const preserved = await run({ EDITABLE_PIXEL_TEST_HOST_REGISTERED: "1" });
  assert.deepEqual(preserved.output.registrations.map(({ status }) => status), ["preserved", "preserved"]);
  assert.deepEqual(preserved.calls, [["--version"], ["--version"], ["mcp", "get", "editable-pixel"], ["mcp", "get", "editable-pixel"]]);
  const replaced = await run({ EDITABLE_PIXEL_TEST_HOST_REGISTERED: "1" }, true);
  assert.deepEqual(replaced.output.registrations.map(({ status }) => status), ["replaced", "replaced"]);
  assert.deepEqual(replaced.calls, [
    ["--version"], ["--version"], ["mcp", "get", "editable-pixel"], ["mcp", "remove", "editable-pixel"],
    ["mcp", "add", "editable-pixel", "--", process.execPath, mcp],
    ["mcp", "get", "editable-pixel"], ["mcp", "remove", "--scope", "user", "editable-pixel"],
    ["mcp", "add", "--scope", "user", "editable-pixel", "--", process.execPath, mcp]
  ]);
  await assert.rejects(run({ EDITABLE_PIXEL_TEST_HOST_MISSING: "1" }, true), (error) => {
    const diagnostic = error.stderr.trim().split("\n").find((line) => line.startsWith('{"error":'));
    assert.equal(JSON.parse(diagnostic).error.code, "HOST_COMMAND_NOT_FOUND");
    return true;
  });
  process.stdout.write("Isolated host registration: .cmd/native launchers, path arguments, preserve/replace, and missing-host diagnostics passed.\n");
}
