import { execFile as execFileCallback, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const sourceRoot = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "editable-pixel-source-install-"));
const checkout = join(temporary, "repo");
let server;

try {
  const { stdout } = await execFile("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: sourceRoot,
    encoding: "buffer"
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  await Promise.all(files.map(async (file) => {
    const destination = join(checkout, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(sourceRoot, file), destination, { preserveTimestamps: true });
  }));
  await run("pnpm", ["install", "--frozen-lockfile"]);
  await run("pnpm", ["build"]);

  const port = await availablePort();
  server = spawn("pnpm", ["--filter", "@editable-pixel/web", "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: checkout,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });

  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Development server exited early.\n${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (!ready) throw new Error(`Development server did not become ready.\n${logs}`);
  process.stdout.write("Isolated source install, build, and development server check passed.\n");
} finally {
  if (server?.exitCode === null) {
    const exited = new Promise((resolvePromise) => server.once("exit", resolvePromise));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
      await exited;
    }
  }
  await rm(temporary, { recursive: true, force: true });
}

async function run(command, args) {
  await execFile(command, args, { cwd: checkout, env: process.env, maxBuffer: 20 * 1024 * 1024 });
}

async function availablePort() {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  await new Promise((resolvePromise, reject) => listener.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}
