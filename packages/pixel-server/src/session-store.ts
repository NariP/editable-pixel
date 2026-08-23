import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  PatchHistory,
  applyPatch,
  createDocumentPatch,
  createPalettePixelPatch,
  createPixelPatch,
  getPixels,
  type Patch
} from "@editable-pixel/core";
import {
  assertPixelDocument,
  createPixelDocument,
  parsePixelDocument,
  serializePixelDocument,
  type PixelDocument,
  type Selection
} from "@editable-pixel/document";

export interface SessionSummary {
  id: string;
  documentId: string;
  revision: number;
  documentName: string;
  host: SessionHost;
  selection?: Selection;
  pendingPatchIds: string[];
  clients: string[];
  createdAt: string;
}

export type SessionHost = "browser" | "codex" | "claude";

export interface SessionSnapshot extends SessionSummary {
  document: PixelDocument;
}

interface SessionRecord {
  id: string;
  document: PixelDocument;
  documentPath?: string;
  outputDirectory: string;
  host: SessionHost;
  fileFingerprint?: string;
  persistentToken: string;
  bootstrapToken?: string;
  pending: Map<string, { patch: Patch; before: PixelDocument; after: PixelDocument }>;
  history: PatchHistory;
  clients: Set<string>;
  agentClients: Map<string, number>;
  createdAt: string;
}

export class SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();

  async create(options: {
    document?: PixelDocument;
    documentPath?: string;
    outputDirectory?: string;
    host?: SessionHost;
  } = {}): Promise<{ session: SessionSnapshot; bootstrapToken: string; persistentToken: string }> {
    const resolvedPath = options.documentPath ? await canonicalFile(options.documentPath) : undefined;
    const document = options.document
      ? structuredClone(options.document)
      : resolvedPath
        ? parsePixelDocument(await readFile(resolvedPath, "utf8"))
        : createPixelDocument({ width: 32, height: 32 });
    assertPixelDocument(document);
    const outputDirectory = await canonicalDirectory(
      options.outputDirectory ?? (resolvedPath ? dirname(resolvedPath) : process.cwd())
    );
    const host = options.host ?? "browser";
    if (!(["browser", "codex", "claude"] as const).includes(host)) {
      throw new SessionError("HOST_MODE_INVALID", "Session host must be browser, codex, or claude.", 400);
    }
    const id = token(18);
    const bootstrapToken = token(32);
    const persistentToken = token(32);
    const record: SessionRecord = {
      id,
      document,
      ...(resolvedPath ? { documentPath: resolvedPath, fileFingerprint: await fingerprint(resolvedPath) } : {}),
      outputDirectory,
      host,
      persistentToken,
      bootstrapToken,
      pending: new Map(),
      history: new PatchHistory(),
      clients: new Set(),
      agentClients: new Map(),
      createdAt: new Date().toISOString()
    };
    this.#sessions.set(id, record);
    return { session: snapshot(record), bootstrapToken, persistentToken };
  }

  list(): SessionSummary[] {
    return [...this.#sessions.values()].map(summary);
  }

  get(id: string): SessionSnapshot {
    return snapshot(this.require(id));
  }

  authenticate(id: string, candidate: string, consumeBootstrap = false): { persistentToken: string } {
    const session = this.require(id);
    if (candidate === session.persistentToken) return { persistentToken: session.persistentToken };
    if (candidate && candidate === session.bootstrapToken) {
      if (consumeBootstrap) delete session.bootstrapToken;
      return { persistentToken: session.persistentToken };
    }
    throw new SessionError("AUTH_INVALID", "Session token is invalid or expired.", 401);
  }

  close(id: string): void {
    const session = this.require(id);
    session.pending.clear();
    session.clients.clear();
    session.agentClients.clear();
    session.persistentToken = "";
    delete session.bootstrapToken;
    this.#sessions.delete(id);
  }

  addClient(id: string, clientId: string): SessionSnapshot {
    const session = this.require(id);
    session.clients.add(clientId);
    return snapshot(session);
  }

  removeClient(id: string, clientId: string): void {
    this.#sessions.get(id)?.clients.delete(clientId);
  }

  touchClient(id: string, clientId: string): SessionSnapshot {
    const session = this.require(id);
    session.agentClients.set(clientId, Date.now());
    return snapshot(session);
  }

  setSelection(id: string, selection: Selection | undefined): SessionSnapshot {
    const session = this.require(id);
    const next = structuredClone(session.document);
    if (selection) next.selection = selection;
    else delete next.selection;
    assertPixelDocument(next);
    const patch = createDocumentPatch(session.document, next, selection ? "Set selection" : "Clear selection");
    session.document = session.history.apply(session.document, patch);
    return snapshot(session);
  }

  previewPatch(id: string, patch: Patch): { patch: Patch; before: PixelDocument; after: PixelDocument } {
    const session = this.require(id);
    assertPatchLimit(patch);
    assertActiveSelection(session, patch);
    const before = structuredClone(session.document);
    const after = applyPatch(session.document, patch);
    const preview = { patch, before, after };
    session.pending.set(patch.id, preview);
    return structuredClone(preview);
  }

  createPatch(id: string, input: {
    layerId?: string;
    frameId?: string;
    reason: string;
    requireSelection?: boolean;
    newColors?: string[];
    changes: Array<{ x: number; y: number; colorIndex: number }>;
  }): Patch {
    const session = this.require(id);
    const selection = session.document.selection;
    if ((input.requireSelection ?? true) && !selection) {
      throw new SessionError(
        "SELECTION_REQUIRED",
        "No browser selection is active. Select an area or a palette color in the editor, then retry.",
        409
      );
    }
    const layerId = input.layerId ?? selection?.layerId ?? session.document.layers[0]!.id;
    const frameId = input.frameId ?? selection?.frameId ?? session.document.frames[0]!.id;
    if (selection && (selection.layerId !== layerId || selection.frameId !== frameId)) {
      throw new SessionError(
        "SELECTION_TARGET_MISMATCH",
        "The requested layer/frame differs from the active selection. Select the intended target and retry.",
        409
      );
    }
    if (input.changes.length > 1_000_000) {
      throw new SessionError("PATCH_TOO_LARGE", "Patch exceeds the 1,000,000 pixel change limit.", 413);
    }
    const pixels = getPixels(session.document, layerId, frameId);
    const width = session.document.canvas.width;
    try {
      const changes = input.changes.map((change) => {
          if (!Number.isInteger(change.x) || !Number.isInteger(change.y) || change.x < 0 || change.y < 0 || change.x >= width || change.y >= session.document.canvas.height) {
            throw new SessionError("COORDINATE_INVALID", `Pixel (${change.x}, ${change.y}) is outside the canvas.`, 400);
          }
          const index = change.y * width + change.x;
          return { index, before: pixels[index]!, after: change.colorIndex };
        });
      return input.newColors?.length
        ? createPalettePixelPatch(
          session.document,
          layerId,
          frameId,
          input.newColors,
          changes,
          selection,
          input.reason
        )
        : createPixelPatch(
        session.document,
        layerId,
        frameId,
        changes,
        selection,
        input.reason
      );
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(
        "PATCH_INVALID",
        error instanceof Error ? error.message : "The requested pixel patch is invalid.",
        400
      );
    }
  }

  async applyPatch(id: string, patchOrId: Patch | string): Promise<SessionSnapshot> {
    const session = this.require(id);
    await this.assertFileUnchanged(session);
    const patch = typeof patchOrId === "string" ? session.pending.get(patchOrId)?.patch : patchOrId;
    if (!patch) throw new SessionError("PATCH_NOT_FOUND", "Preview the patch again before applying it.", 404);
    assertPatchLimit(patch);
    assertActiveSelection(session, patch);
    session.document = session.history.apply(session.document, patch);
    session.pending.delete(patch.id);
    await this.persist(session);
    return snapshot(session);
  }

  rejectPatch(id: string, patchId: string): SessionSnapshot {
    const session = this.require(id);
    if (!session.pending.delete(patchId)) {
      throw new SessionError("PATCH_NOT_FOUND", "The pending patch does not exist.", 404);
    }
    return snapshot(session);
  }

  async undo(id: string): Promise<SessionSnapshot> {
    const session = this.require(id);
    await this.assertFileUnchanged(session);
    session.document = session.history.undo(session.document);
    await this.persist(session);
    return snapshot(session);
  }

  async redo(id: string): Promise<SessionSnapshot> {
    const session = this.require(id);
    await this.assertFileUnchanged(session);
    session.document = session.history.redo(session.document);
    await this.persist(session);
    return snapshot(session);
  }

  outputPath(id: string, filename: string): string {
    const session = this.require(id);
    if (basename(filename) !== filename || filename === "." || filename === "..") {
      throw new SessionError("PATH_OUTSIDE_ALLOWED_ROOT", "Output filename must not contain a path.", 403);
    }
    return join(session.outputDirectory, filename);
  }

  private require(id: string): SessionRecord {
    const session = this.#sessions.get(id);
    if (!session) throw new SessionError("SESSION_NOT_FOUND", "Session not found or already closed.", 404);
    return session;
  }

  private async assertFileUnchanged(session: SessionRecord): Promise<void> {
    if (!session.documentPath || !session.fileFingerprint) return;
    const current = await fingerprint(session.documentPath);
    if (current !== session.fileFingerprint) {
      throw new SessionError(
        "FILE_CONFLICT",
        "The document changed on disk. Reopen it before applying this patch.",
        409
      );
    }
  }

  private async persist(session: SessionRecord): Promise<void> {
    if (!session.documentPath) return;
    const currentPath = await canonicalFile(session.documentPath);
    if (currentPath !== session.documentPath) {
      throw new SessionError("PATH_OUTSIDE_ALLOWED_ROOT", "The document path changed unexpectedly.", 403);
    }
    const fileInfo = await lstat(currentPath);
    if (fileInfo.isSymbolicLink()) throw new SessionError("SYMLINK_REJECTED", "Symbolic link documents are not writable.", 403);
    const temporary = join(dirname(currentPath), `.${basename(currentPath)}.${token(8)}.tmp`);
    await writeFile(temporary, serializePixelDocument(session.document), { mode: 0o600, flag: "wx" });
    await rename(temporary, currentPath);
    session.fileFingerprint = await fingerprint(currentPath);
  }
}

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "SessionError";
  }
}

function summary(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    documentId: session.document.id,
    revision: session.document.revision,
    documentName: session.documentPath ? basename(session.documentPath) : "Untitled.pixel.json",
    host: session.host,
    ...(session.document.selection ? { selection: session.document.selection } : {}),
    pendingPatchIds: [...session.pending.keys()],
    clients: activeClients(session),
    createdAt: session.createdAt
  };
}

function activeClients(session: SessionRecord): string[] {
  const cutoff = Date.now() - 60_000;
  for (const [client, lastSeen] of session.agentClients) {
    if (lastSeen < cutoff) session.agentClients.delete(client);
  }
  return [...session.clients, ...session.agentClients.keys()];
}

function assertActiveSelection(session: SessionRecord, patch: Patch): void {
  if (patch.kind === "document" || !patch.selection) return;
  const active = session.document.selection;
  if (!active || !sameSelection(active, patch.selection)) {
    throw new SessionError(
      "SELECTION_CONFLICT",
      "The browser selection changed after this patch was created. Read the current selection and preview a new patch.",
      409
    );
  }
}

function sameSelection(left: Selection, right: Selection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshot(session: SessionRecord): SessionSnapshot {
  return { ...summary(session), document: structuredClone(session.document) };
}

async function canonicalFile(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new SessionError("INVALID_DOCUMENT_PATH", "Document must be a regular, non-symlink file.", 400);
  }
  return realpath(absolute);
}

async function canonicalDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new SessionError("INVALID_OUTPUT_PATH", "Output path must be a regular directory.", 400);
  }
  return realpath(absolute);
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
}

function assertPatchLimit(patch: Patch): void {
  if (patch.kind !== "document" && patch.changes.length > 1_000_000) {
    throw new SessionError("PATCH_TOO_LARGE", "Patch exceeds the 1,000,000 pixel change limit.", 413);
  }
}

function token(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
