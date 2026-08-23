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
    "package/README.md",
    "package/LICENSE"
  ]) {
    if (!listing.includes(required)) throw new Error(`Package is missing ${required}.`);
  }
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error("Package checksum was not generated.");

  await install(archive);
  await install(archive);
  const binaryDirectory = join(prefix, "node_modules", ".bin");
  const cli = join(binaryDirectory, "editable-pixel");
  const mcp = join(binaryDirectory, "editable-pixel-mcp");
  const server = join(binaryDirectory, "editable-pixel-server");
  await Promise.all([access(cli), access(mcp), access(server)]);

  const version = (await execFile(cli, ["--version"], { env: environment })).stdout.trim();
  if (version !== "1.0.0") throw new Error(`Unexpected installed version: ${version}`);
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

  const daemon = JSON.parse(await readFile(registry, "utf8"));
  daemonPid = daemon.pid;
  const mcpProcess = spawn(mcp, [], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  if (mcpProcess.exitCode !== null) throw new Error("Installed MCP executable exited during startup.");
  mcpProcess.kill("SIGTERM");
  await execFile(cli, ["session", "close", opened.sessionId], { env: environment });
  await execFile(cli, ["session", "close", concurrent.sessionId], { env: environment });

  await execFile("npm", ["uninstall", "--prefix", prefix, "--no-package-lock", "editable-pixel"], { env: environment });
  try {
    await access(cli);
    throw new Error("CLI binary remained after uninstall.");
  } catch (error) {
    if (error instanceof Error && error.message === "CLI binary remained after uninstall.") throw error;
  }

  process.stdout.write(`Distribution install, update, execution, checksum, and removal passed (${checksum.slice(0, 12)}…).\n`);
} finally {
  if (daemonPid) {
    try { process.kill(daemonPid, "SIGTERM"); } catch { /* already stopped */ }
  }
  await rm(temporary, { recursive: true, force: true });
}

async function install(archive) {
  await execFile("npm", ["install", "--prefix", prefix, "--no-package-lock", archive], { env: environment });
}
