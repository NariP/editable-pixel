import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ProjectRevisionConflictError,
  ProjectUnavailableError,
  assertPixelProject,
  clonePixelProject,
  parsePixelProject,
  serializePixelProject,
  type PixelProject
} from "@editable-pixel/project";

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class FileProjectStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async create(project: PixelProject): Promise<PixelProject> {
    assertPixelProject(project);
    await this.ensureRoot();
    const path = this.pathFor(project.id);
    try {
      await writeFile(path, serializePixelProject(project), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new ProjectRevisionConflictError(`Project ${project.id} already exists.`);
      }
      throw new ProjectUnavailableError(error instanceof Error ? error.message : String(error));
    }
    return structuredClone(project);
  }

  async open(id: string): Promise<PixelProject> {
    await this.ensureRoot();
    try {
      return parsePixelProject(await readFile(this.pathFor(id), "utf8"));
    } catch (error) {
      if (error instanceof ProjectRevisionConflictError) throw error;
      throw new ProjectUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }

  async persist(project: PixelProject, expectedRevision: number): Promise<PixelProject> {
    assertPixelProject(project);
    await this.ensureRoot();
    const path = this.pathFor(project.id);
    let before: string;
    let current: PixelProject;
    try {
      before = await fingerprint(path);
      current = parsePixelProject(await readFile(path, "utf8"));
    } catch (error) {
      throw new ProjectUnavailableError(error instanceof Error ? error.message : String(error));
    }
    if (current.revision !== expectedRevision) {
      throw new ProjectRevisionConflictError(
        `Project ${project.id} is at revision ${current.revision}; expected ${expectedRevision}.`
      );
    }
    if (project.revision <= expectedRevision) {
      throw new ProjectRevisionConflictError(
        `Project ${project.id} must advance beyond revision ${expectedRevision}.`
      );
    }

    const temporary = join(this.root, `.${project.id}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serializePixelProject(project), { encoding: "utf8", flag: "wx", mode: 0o600 });
      if (await fingerprint(path) !== before) {
        throw new ProjectRevisionConflictError(`Project ${project.id} changed on disk while saving.`);
      }
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      if (error instanceof ProjectRevisionConflictError) throw error;
      throw new ProjectUnavailableError(error instanceof Error ? error.message : String(error));
    }
    return structuredClone(project);
  }

  async clone(id: string, options: { id: string; name: string; now?: string }): Promise<PixelProject> {
    const source = await this.open(id);
    const clone = clonePixelProject(source, options);
    return this.create(clone);
  }

  pathFor(id: string): string {
    if (!PROJECT_ID.test(id)) {
      throw new ProjectUnavailableError("Project ID must not contain a path or unsupported characters.");
    }
    return join(this.root, `${id}.pixel-project.json`);
  }

  private async ensureRoot(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("Project store root must be a regular, non-symlink directory.");
      }
    } catch (error) {
      throw new ProjectUnavailableError(error instanceof Error ? error.message : String(error));
    }
  }
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
