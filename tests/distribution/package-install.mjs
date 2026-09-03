import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const temporary = await mkdtemp(join(tmpdir(), "editable-pixel-distribution-"));
const packDirectory = join(temporary, "pack");
const prefix = join(temporary, "install");
const registry = join(temporary, "registry.json");
const fixture = resolve("tests/fixtures/character.pixel.json");
const installer = resolve("install.sh");
const environment = { ...process.env, EDITABLE_PIXEL_REGISTRY: registry };
let daemonPid;

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
    "package/docs/media/editor-overview.png",
    "package/docs/media/robot-motion-64.gif",
    "package/docs/media/before-after-palette.png",
    "package/docs/media/before-after-ground.png",
    "package/docs/media/before-after-lighting.png",
    "package/docs/media/editor-palette-ai.png",
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
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");

  const installEnvironment = { ...environment, EDITABLE_PIXEL_PACKAGE_SPEC: archive };
  await execFile("sh", [installer, "--prefix", prefix], { env: installEnvironment });
  await execFile("sh", [installer, "--prefix", prefix], { env: installEnvironment });
  const binaryDirectory = join(prefix, "bin");
  const cli = join(binaryDirectory, "editable-pixel");
  const mcp = join(binaryDirectory, "editable-pixel-mcp");
  const server = join(binaryDirectory, "editable-pixel-server");
  await Promise.all([access(cli), access(mcp), access(server)]);

  const version = (await execFile(cli, ["--version"], { env: environment })).stdout.trim();
  if (version !== "1.0.0") throw new Error(`Unexpected installed version: ${version}`);
  const skillRoot = join(temporary, "skills");
  const installedSkill = JSON.parse((await execFile(
    cli,
    ["--json", "install-skill", "--host", "codex", "--target", skillRoot],
    { env: environment }
  )).stdout);
  if (!installedSkill.outputs?.[0]) throw new Error("Installed CLI did not report the skill path.");
  await access(join(skillRoot, "editable-pixel", "SKILL.md"));
  await execFile(cli, ["--json", "validate", fixture], { env: environment });
  const [openedOutput, concurrentOutput] = await Promise.all([
    execFile(cli, ["--json", "open", fixture, "--host", "codex", "--no-browser"], { env: environment }),
    execFile(cli, ["--json", "open", fixture, "--host", "claude", "--no-browser"], { env: environment })
  ]);
  const opened = JSON.parse(openedOutput.stdout);
  const concurrent = JSON.parse(concurrentOutput.stdout);
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

  const daemon = JSON.parse(await readFile(registry, "utf8"));
  daemonPid = daemon.pid;
  const mcpProcess = spawn(mcp, [], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  if (mcpProcess.exitCode !== null) throw new Error("Installed MCP executable exited during startup.");
  mcpProcess.kill("SIGTERM");
  await execFile(cli, ["session", "close", opened.sessionId], { env: environment });
  await execFile(cli, ["session", "close", concurrent.sessionId], { env: environment });
  await execFile(cli, ["session", "close", blank.sessionId], { env: environment });

  await execFile("sh", [installer, "--uninstall", "--prefix", prefix], { env: environment });
  try {
    await access(cli);
    throw new Error("CLI binary remained after uninstall.");
  } catch (error) {
    if (error instanceof Error && error.message === "CLI binary remained after uninstall.") throw error;
  }

  process.stdout.write(`Distribution install, update, execution, and removal passed (archive SHA256 fingerprint: ${checksum.slice(0, 12)}…).\n`);
} finally {
  if (daemonPid) {
    try { process.kill(daemonPid, "SIGTERM"); } catch { /* already stopped */ }
  }
  await rm(temporary, { recursive: true, force: true });
}
