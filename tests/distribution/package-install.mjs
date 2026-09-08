import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { decodePng, encodePng } from "@editable-pixel/image-codec";
import { execFile } from "./process.mjs";
import { verifyHostRegistration } from "./host-registration.mjs";

const temporary = await mkdtemp(join(tmpdir(), "editable-pixel-distribution-"));
const packDirectory = join(temporary, "pack");
// npm's generated .cmd uses an unquoted SET dp0; '&' in the install directory
// breaks before our JS runs. Keep that upstream limit explicit in the docs.
const prefix = join(temporary, process.platform === "win32" ? "install path (한글)" : "install path (한글) & tools");
const registry = join(temporary, "registry.json");
const fixture = resolve("tests/fixtures/character.pixel.json");
const installer = resolve("install.sh");
const environment = { ...process.env, EDITABLE_PIXEL_REGISTRY: registry };
let daemonPid;
let mcpClient;
let mcpProxy;

try {
  await mkdir(packDirectory);
  await execFile("pnpm", ["--filter", "editable-pixel", "pack", "--pack-destination", packDirectory], {
    cwd: resolve("."), env: environment
  });
  const archiveName = (await readdir(packDirectory)).find((name) => name.endsWith(".tgz"));
  if (!archiveName) throw new Error("Package archive was not produced.");
  const archive = join(packDirectory, archiveName);
  const listing = (await execFile("tar", ["-tzf", archive], { env: environment })).stdout;
  for (const required of [
    "package/dist/cli.js",
    "package/dist/server-runner.js",
    "package/dist/mcp.js",
    "package/web/index.html",
    "package/skills/editable-pixel/SKILL.md",
    "package/skills/editable-pixel/references/live-editing.md",
    "package/skills/editable-pixel/references/cli.md",
    "package/docs/project-model.md",
    "package/docs/mcp.md",
    "package/install.sh",
    "package/README.md",
    "package/CONTRIBUTING.md",
    "package/LICENSE"
  ]) {
    if (!listing.includes(required)) throw new Error(`Package is missing ${required}.`);
  }
  // Slimming guards: README screenshots, build sourcemaps, and bundled webfonts
  // are development-only weight and must never reach the published archive.
  for (const [pattern, reason] of [
    [/^package\/docs\/media\//m, "README media"],
    [/\.js\.map$/m, "build sourcemaps"],
    [/\.woff2?$/m, "bundled webfonts"]
  ]) {
    if (pattern.test(listing)) throw new Error(`Package must not ship ${reason}.`);
  }
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");

  const installEnvironment = { ...environment, EDITABLE_PIXEL_PACKAGE_SPEC: archive };
  const windows = process.platform === "win32";
  const install = () => windows
    ? execFile("npm", ["install", "--global", "--prefix", prefix, archive], { env: environment })
    : execFile("sh", [installer, "--prefix", prefix], { env: installEnvironment });
  await install();
  await install();
  const binaryDirectory = windows ? prefix : join(prefix, "bin");
  const extension = windows ? ".cmd" : "";
  const cli = join(binaryDirectory, `editable-pixel${extension}`);
  const mcp = join(binaryDirectory, `editable-pixel-mcp${extension}`);
  const server = join(binaryDirectory, `editable-pixel-server${extension}`);
  await Promise.all([access(cli), access(mcp), access(server)]);

  const version = (await execFile(cli, ["--version"], { env: environment })).stdout.trim();
  const packageManifest = JSON.parse(await readFile(resolve("packages/pixel-cli/package.json"), "utf8"));
  if (version !== packageManifest.version) throw new Error(`Unexpected installed version: ${version}`);
  const packageRoot = windows ? join(prefix, "node_modules", "editable-pixel") : join(prefix, "lib", "node_modules", "editable-pixel");
  // The image codecs are WebAssembly, and `.wasm` is not something a bundler
  // inlines. If npm did not install @jsquash beside the package, convert and
  // render would fail only in the published build — so assert it here.
  const installRoot = windows ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
  for (const wasm of [
    join("@jsquash", "png", "codec", "pkg", "squoosh_png_bg.wasm"),
    join("@jsquash", "jpeg", "codec", "dec", "mozjpeg_dec.wasm"),
    join("@jsquash", "webp", "codec", "dec", "webp_dec.wasm")
  ]) {
    await access(join(installRoot, wasm)).catch(() => access(join(packageRoot, "node_modules", wasm)));
  }
  // sharp's prebuilt binaries were the single largest chunk of the install.
  await assert.rejects(access(join(installRoot, "sharp")), { code: "ENOENT" }, "sharp came back into the install.");
  await assert.rejects(access(join(installRoot, "@img")), { code: "ENOENT" }, "@img prebuilds came back into the install.");
  await verifyHostRegistration({ cli, entrypoint: join(packageRoot, "dist", "mcp.js"), temporary, environment });
  const skillRoot = join(temporary, "skills");
  const installedSkill = JSON.parse((await execFile(
    cli,
    ["--json", "install-skill", "--host", "codex", "--target", skillRoot],
    { env: environment }
  )).stdout);
  if (!installedSkill.outputs?.[0]) throw new Error("Installed CLI did not report the skill path.");
  await access(join(skillRoot, "editable-pixel", "SKILL.md"));
  await execFile(cli, ["--json", "validate", fixture], { env: environment });
  const inputImage = join(temporary, "입력 image & frame.png");
  const convertedFile = join(temporary, "converted.pixel.json");
  const outputImage = join(temporary, "exported.png");
  const solid = new Uint8ClampedArray(16 * 16 * 4);
  for (let offset = 0; offset < solid.length; offset += 4) solid.set([0xf0, 0x80, 0x20, 0xff], offset);
  await writeFile(inputImage, await encodePng({ data: solid, width: 16, height: 16 }));
  await execFile(cli, ["convert", inputImage, "--size", "64", "--output", convertedFile], { env: environment });
  await execFile(cli, ["validate", convertedFile], { env: environment });
  const converted = JSON.parse(await readFile(convertedFile, "utf8"));
  assert.deepEqual(converted.canvas, { width: 64, height: 64 });
  await execFile(cli, ["render", convertedFile, "--scale", "2", "--output", outputImage], { env: environment });
  const exported = await decodePng(await readFile(outputImage));
  assert.equal(exported.width, 128);
  assert.equal(exported.height, 128);
  const center = (64 * 128 + 64) * 4;
  assert.deepEqual([...exported.data.subarray(center, center + 4)], [240, 128, 32, 255]);
  const [openedOutput, concurrentOutput] = await Promise.all([
    execFile(cli, ["--json", "open", fixture, "--host", "codex", "--no-browser"], { env: environment }),
    execFile(cli, ["--json", "open", fixture, "--host", "claude", "--no-browser"], { env: environment })
  ]);
  const opened = JSON.parse(openedOutput.stdout);
  const concurrent = JSON.parse(concurrentOutput.stdout);
  daemonPid = JSON.parse(await readFile(registry, "utf8")).pid;
  if (!opened.sessionId || !opened.launchUrl || !concurrent.sessionId) {
    throw new Error("Installed CLI did not open concurrent isolated sessions on the shared daemon.");
  }
  if (opened.sessionId === concurrent.sessionId) throw new Error("Concurrent open calls reused the same session.");
  const blank = JSON.parse((await execFile(
    cli,
    ["--json", "open", "--host", "browser", "--no-browser"],
    { cwd: temporary, env: environment }
  )).stdout);
  if (!blank.sessionId || !blank.url) throw new Error("Installed CLI did not open a source-less local editor session.");
  const editor = await fetch(new URL("/", blank.url));
  assert.equal(editor.status, 200);
  assert.match(await editor.text(), /<div id="root">/);

  const viewHelp = (await execFile(cli, ["view", "set", "--help"], { env: environment })).stdout;
  if (!viewHelp.includes("--grid-mode") || !viewHelp.includes("isometric")) {
    throw new Error("Installed CLI is missing isometric view controls.");
  }
  const diamond = JSON.parse((await execFile(cli, [
    "--json", "selection", "diamond", "--session", blank.sessionId,
    "--center-x", "4", "--center-y", "4", "--width", "8"
  ], { env: environment })).stdout);
  if (diamond.selection?.type !== "mask" || diamond.selection.indices.length !== 16) {
    throw new Error("Installed CLI did not create the exact isometric selection.");
  }
  await execFile(cli, ["undo", "--session", blank.sessionId], { env: environment });
  const restoredSelection = JSON.parse((await execFile(cli, [
    "--json", "selection", "get", "--session", blank.sessionId
  ], { env: environment })).stdout);
  if (restoredSelection.selection !== null) throw new Error("Installed CLI diamond selection did not share Undo.");

  const daemonRegistry = JSON.parse(await readFile(registry, "utf8"));
  let actionRequests = 0;
  mcpProxy = createServer((request, response) => {
    if (request.method === "POST" && request.url.endsWith("/actions")) actionRequests++;
    const outgoing = httpRequest({
      hostname: "127.0.0.1", port: daemonRegistry.port, path: request.url, method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${daemonRegistry.port}` }
    }, (incoming) => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(response);
    });
    outgoing.on("error", () => { response.writeHead(502); response.end(); });
    request.pipe(outgoing);
  });
  await new Promise((resolve, reject) => {
    mcpProxy.once("error", reject);
    mcpProxy.listen(0, "127.0.0.1", resolve);
  });
  const mcpRegistry = join(temporary, "mcp-registry.json");
  await writeFile(mcpRegistry, JSON.stringify({ ...daemonRegistry, port: mcpProxy.address().port }), { mode: 0o600 });
  const readSessionState = async (suffix = "") => {
    const response = await fetch(`http://127.0.0.1:${daemonRegistry.port}/api/sessions/${blank.sessionId}${suffix}`, {
      headers: { Authorization: `Bearer ${daemonRegistry.daemonToken}` }
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  mcpClient = new Client({ name: "distribution-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: mcp, env: { ...environment, EDITABLE_PIXEL_REGISTRY: mcpRegistry }, stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  await mcpClient.connect(transport);
  assert.equal(mcpClient.getServerVersion().version, packageManifest.version);
  const catalog = await mcpClient.listTools();
  for (const tool of ["get_metadata", "get_design_context", "set_selection", "use_editable_pixel", "control_web"]) {
    assert.ok(catalog.tools.some(({ name }) => name === tool), `Installed MCP is missing ${tool}.`);
  }
  const sessions = await mcpClient.callTool({ name: "list_sessions", arguments: {} });
  assert.notEqual(sessions.isError, true);
  assert.ok(JSON.stringify(sessions).includes(blank.sessionId), "MCP must connect to the same CLI daemon.");
  const beforeMutation = await readSessionState();
  const beforeHistory = await readSessionState("/history");
  const mutation = await mcpClient.callTool({ name: "use_editable_pixel", arguments: {
    session_id: blank.sessionId, base_revision: beforeMutation.revision, reason: "Installed stdio single dispatch",
    action: { type: "set_frame_duration", frame_id: beforeMutation.document.frames[0].id, duration_ms: 160 }, response_format: "json"
  } });
  assert.notEqual(mutation.isError, true, "Installed mutation must return success, not a duplicate-dispatch conflict.");
  await mcpClient.callTool({ name: "get_metadata", arguments: { session_id: blank.sessionId } });
  const afterMutation = await readSessionState();
  const afterHistory = await readSessionState("/history");
  assert.equal(afterMutation.revision, beforeMutation.revision + 1);
  assert.equal(afterMutation.document.frames[0].durationMs, 160);
  assert.equal(afterHistory.entries.filter(({ state }) => state === "applied").length,
    beforeHistory.entries.filter(({ state }) => state === "applied").length + 1);
  await mcpClient.close();
  mcpClient = undefined;
  await new Promise((resolve) => mcpProxy.close(resolve));
  mcpProxy = undefined;
  assert.equal(actionRequests, 1, "One installed MCP call must issue exactly one HTTP action request.");
  assert.deepEqual(await readSessionState(), afterMutation, "No delayed duplicate mutation may change the session after stdio closes.");
  assert.deepEqual(await readSessionState("/history"), afterHistory);

  await execFile(cli, ["session", "close", opened.sessionId], { env: environment });
  await execFile(cli, ["session", "close", concurrent.sessionId], { env: environment });
  await execFile(cli, ["session", "close", blank.sessionId], { env: environment });

  // Stop the installed daemon before uninstalling files (Windows keeps executables open).
  await stopDaemon();
  if (windows) await execFile("npm", ["uninstall", "--global", "--prefix", prefix, "editable-pixel"], { env: environment });
  else await execFile("sh", [installer, "--uninstall", "--prefix", prefix], { env: environment });
  await assert.rejects(access(cli), { code: "ENOENT" }, "CLI binary remained after uninstall.");

  process.stdout.write(`Distribution install, update, execution, and removal passed (archive SHA256 fingerprint: ${checksum.slice(0, 12)}…).\n`);
} finally {
  await mcpClient?.close();
  if (mcpProxy) await new Promise((resolve) => mcpProxy.close(resolve));
  await stopDaemon();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

async function stopDaemon() {
  // Even a failed concurrent open may have started our isolated daemon.
  if (!daemonPid) {
    try { daemonPid = JSON.parse(await readFile(registry, "utf8")).pid; } catch { return; }
  }
  try { process.kill(daemonPid, "SIGTERM"); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try { process.kill(daemonPid, 0); } catch (error) {
      if (error.code !== "ESRCH") throw error;
      daemonPid = undefined;
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("The distribution-test daemon did not stop.");
}
