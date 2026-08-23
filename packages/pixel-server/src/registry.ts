import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface ServerRegistry {
  pid: number;
  port: number;
  daemonToken: string;
  startedAt: string;
}

export function registryPath(): string {
  const user = typeof process.getuid === "function" ? process.getuid() : "user";
  return process.env.EDITABLE_PIXEL_REGISTRY ?? join(tmpdir(), `editable-pixel-${user}`, "server.json");
}

export async function readRegistry(): Promise<ServerRegistry | undefined> {
  try {
    return JSON.parse(await readFile(registryPath(), "utf8")) as ServerRegistry;
  } catch {
    return undefined;
  }
}

export async function writeRegistry(registry: ServerRegistry): Promise<void> {
  const path = registryPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(registry), { mode: 0o600 });
  await rename(temporary, path);
}
