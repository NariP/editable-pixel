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
let serverPort;

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
  serverPort = port;
  server = spawn("pnpm", ["--filter", "@editable-pixel/web", "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: checkout,
    env: process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });

  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Development server exited early.\n${logs}`);
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
} finally {
  if (server?.pid) {
    // pnpm's exit can precede Vite/esbuild shutdown. Wait for their inherited pipes too.
    const closed = server.stdout.destroyed && server.stderr.destroyed
      ? Promise.resolve(true)
      : new Promise((resolvePromise) => server.once("close", () => resolvePromise(true)));
    if (process.platform === "win32") {
      if (server.exitCode === null && server.signalCode === null) {
        await execFile("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
      }
    } else {
      const signalGroup = (signal) => {
        try { process.kill(-server.pid, signal); } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      signalGroup("SIGTERM");
      const stopped = await Promise.race([
        closed,
        new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000).unref())
      ]);
      if (!stopped) signalGroup("SIGKILL");
    }
    await closed;
    if (serverPort !== undefined) await availablePort(serverPort);
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
process.stdout.write("Isolated source install, build, development server, and cleanup checks passed.\n");

async function run(command, args) {
  await execFile(command, args, { cwd: checkout, env: process.env, maxBuffer: 20 * 1024 * 1024 });
}

async function availablePort(port = 0) {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", resolvePromise);
  });
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback port.");
  await new Promise((resolvePromise, reject) => listener.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}
