import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  applyPatch,
  createDocumentPatch,
  createPalettePixelPatch,
  createPixelPatch,
  createRemapColorsPatch,
  getNormalPixels,
  getPixels,
  type EditItemResult,
  type Patch
} from "@editable-pixel/core";
import {
  DEFAULT_FRAME_LIGHTING,
  assertPixelDocument,
  createPixelDocument,
  parsePixelDocument,
  resolveFrameLighting,
  serializePixelDocument,
  type PixelDocument,
  type Rect,
  type Selection
} from "@editable-pixel/document";
import {
  assertPixelProject,
  parsePixelProject,
  serializePixelProject,
  type PixelProject
} from "@editable-pixel/project";

import {
  applyProjectAction,
  createActionPatch,
  createSelection,
  isProjectAction,
  type EditActor,
  type EditablePixelAction,
  type SelectionCommand
} from "./agent-actions.js";
import type { SessionProjectState } from "./web-actions.js";

export interface SessionProjectContext {
  projectId: string;
  projectName: string;
  projectRevision: number;
  clipId: string;
  clipName: string;
  frameId: string;
  layerId: string;
  layerName: string;
}

export interface MutationSummary {
  baseRevision: number;
  revision: number;
  committed: boolean;
  changedPixels: number;
  results: Array<EditItemResult & { items?: EditItemResult[]; target?: unknown }>;
}

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
  projectContext?: SessionProjectContext;
}

export type SessionHost = "browser" | "codex" | "claude";

export interface SessionSnapshot extends SessionSummary {
  mutation?: MutationSummary;
  document: PixelDocument;
  project?: SessionProjectState;
}

export interface HistoryEntrySummary {
  id: string;
  actor: EditActor;
  client?: string;
  reason: string;
  createdAt: string;
  revisionBefore: number;
  revisionAfter: number;
  state: "applied" | "undone";
  selection?: Selection;
}

export interface DesignContext {
  sessionId: string;
  documentId: string;
  revision: number;
  projectContext?: SessionProjectContext;
  target: { layerId: string; frameId: string };
  selection?: Selection;
  bounds: Rect;
  palette: string[];
  colorIndices: number[][];
  normalValues?: number[][];
}

export interface PaletteContext {
  sessionId: string;
  revision: number;
  target: { layerId: string; frameId: string };
  transparentColorIndex: number;
  colors: Array<{ index: number; rgba: string; usedPixels: number; transparent: boolean }>;
}

export interface MotionContext {
  sessionId: string;
  revision: number;
  activeClipId?: string;
  clips: Array<{
    id: string;
    name: string;
    durationMs: number;
    frames: Array<{
      id: string;
      name: string;
      durationMs: number;
      lightingKeyframe: boolean;
      lightingInterpolation?: PixelDocument["frames"][number]["lightingInterpolation"];
      resolvedLighting: NonNullable<PixelDocument["frames"][number]["lighting"]>;
    }>;
  }>;
}

export interface MetadataContext {
  sessionId: string;
  document: {
    id: string;
    revision: number;
    canvas: PixelDocument["canvas"];
    contentBounds: Rect;
    paletteSize: number;
    layers: Array<{ id: string; name: string; visible: boolean; opacity: number }>;
    frames: Array<{ id: string; name: string; durationMs: number; lightingKeyframe: boolean }>;
  };
  project: null | {
    id: string;
    name: string;
    revision: number;
    sourceCount: number;
    clips: Array<{ id: string; name: string; frameIds: string[] }>;
    active?: PixelProject["active"];
  };
  selection?: Selection;
}

interface SessionHistoryEntry extends Omit<HistoryEntrySummary, "state"> {
  sequence: number;
  beforeDocument: PixelDocument;
  afterDocument: PixelDocument;
  beforeProject?: PixelProject;
  afterProject?: PixelProject;
}

interface SessionRecord {
  id: string;
  document: PixelDocument;
  documentPath?: string;
  project?: PixelProject;
  projectPath?: string;
  projectFingerprint?: string;
  projectContext?: SessionProjectContext;
  outputDirectory: string;
  host: SessionHost;
  fileFingerprint?: string;
  persistentToken: string;
  bootstrapToken?: string;
  pending: Map<string, { patch: Patch; before: PixelDocument; after: PixelDocument }>;
  history: SessionHistory;
  clients: Set<string>;
  agentClients: Map<string, number>;
  createdAt: string;
}

export class SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();

  async create(options: {
    document?: PixelDocument;
    documentPath?: string;
    project?: PixelProject;
    projectPath?: string;
    outputDirectory?: string;
    host?: SessionHost;
  } = {}): Promise<{ session: SessionSnapshot; bootstrapToken: string; persistentToken: string }> {
    if ((options.document || options.documentPath) && (options.project || options.projectPath)) {
      throw new SessionError("SESSION_INPUT_AMBIGUOUS", "Open either a Pixel Document or a Pixel Project, not both.", 400);
    }
    const resolvedPath = options.documentPath ? await canonicalFile(options.documentPath) : undefined;
    const resolvedProjectPath = options.projectPath ? await canonicalFile(options.projectPath) : undefined;
    const project = options.project
      ? structuredClone(options.project)
      : resolvedProjectPath
        ? parsePixelProject(await readFile(resolvedProjectPath, "utf8"))
        : undefined;
    if (project) assertPixelProject(project);
    const projectContext = project ? contextFromProject(project) : undefined;
    const document = project
      ? structuredClone(project.document)
      : options.document
        ? structuredClone(options.document)
        : resolvedPath
          ? parsePixelDocument(await readFile(resolvedPath, "utf8"))
          : createPixelDocument({ width: 32, height: 32 });
    assertPixelDocument(document);
    const outputDirectory = await canonicalDirectory(
      options.outputDirectory ?? (resolvedProjectPath ? dirname(resolvedProjectPath) : resolvedPath ? dirname(resolvedPath) : process.cwd())
    );
    const host = options.host ?? "browser";
    if (!(["browser", "codex", "claude"] as const).includes(host)) {
      throw new SessionError("HOST_MODE_INVALID", "Session host must be browser, codex, or claude.", 400);
    }
    const id = createSessionId();
    const bootstrapToken = token(32);
    const persistentToken = token(32);
    const record: SessionRecord = {
      id,
      document,
      ...(resolvedPath ? { documentPath: resolvedPath, fileFingerprint: await fingerprint(resolvedPath) } : {}),
      ...(project ? { project } : {}),
      ...(resolvedProjectPath ? { projectPath: resolvedProjectPath, projectFingerprint: await fingerprint(resolvedProjectPath) } : {}),
      ...(projectContext ? { projectContext } : {}),
      outputDirectory,
      host,
      persistentToken,
      bootstrapToken,
      pending: new Map(),
      history: new SessionHistory(),
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

  setSelection(
    id: string,
    selection: Selection | undefined,
    actor: EditActor = "user",
    client?: string
  ): SessionSnapshot {
    const session = this.require(id);
    const next = structuredClone(session.document);
    if (selection) next.selection = selection;
    else delete next.selection;
    assertPixelDocument(next);
    if (JSON.stringify(next.selection) === JSON.stringify(session.document.selection)) return snapshot(session);
    const patch = createDocumentPatch(session.document, next, selection ? "Set selection" : "Clear selection");
    const before = structuredClone(session.document);
    const beforeProject = session.project ? structuredClone(session.project) : undefined;
    session.document = applyPatch(session.document, patch);
    if (session.project) {
      session.project = synchronizeProjectRevision(session.project, session.document, session.projectContext);
      session.document = structuredClone(session.project.document);
      session.projectContext = contextFromProject(session.project, session.projectContext);
    }
    session.history.record({
      beforeDocument: before,
      afterDocument: session.document,
      beforeProject,
      afterProject: session.project,
      patch,
      actor,
      client
    });
    return snapshot(session);
  }

  setSelectionCommand(
    id: string,
    command: SelectionCommand,
    actor: EditActor = "ai",
    client = "mcp"
  ): SessionSnapshot {
    const session = this.require(id);
    const fallback = {
      layerId: session.projectContext?.layerId ?? session.document.layers[0]!.id,
      frameId: session.projectContext?.frameId ?? session.document.frames[0]!.id
    };
    try {
      const selection = createSelection(session.document, command, fallback);
      return this.setSelection(id, selection, actor, client);
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(
        "SELECTION_INVALID",
        error instanceof Error ? error.message : "The requested selection is invalid.",
        400
      );
    }
  }

  setProject(id: string, project: PixelProject): SessionSnapshot {
    assertPixelProject(project);
    const session = this.require(id);
    session.project = structuredClone(project);
    session.projectContext = contextFromProject(project, session.projectContext);
    return snapshot(session);
  }

  setProjectContext(id: string, context: SessionProjectContext): SessionSnapshot {
    const session = this.require(id);
    assertSessionProjectContext(context, session.document);
    if (session.project && session.project.id === context.projectId && session.project.revision === context.projectRevision) {
      const clip = session.project.clips.find((candidate) => candidate.id === context.clipId);
      if (!clip || !clip.frameIds.includes(context.frameId)) {
        throw new SessionError("PROJECT_CONTEXT_CONFLICT", "The requested Project context does not match the saved Project.", 409);
      }
    }
    session.projectContext = structuredClone(context);
    return snapshot(session);
  }

  getSelectionContext(id: string, padding = 1): {
    sessionId: string;
    documentId: string;
    revision: number;
    projectContext?: SessionProjectContext;
    selection: Selection;
    bounds: { x: number; y: number; width: number; height: number };
    palette: string[];
    colorIndices: number[][];
  } {
    const session = this.require(id);
    if (!Number.isInteger(padding) || padding < 0 || padding > 8) {
      throw new SessionError("PADDING_INVALID", "Selection context padding must be an integer from 0 to 8.", 400);
    }
    const selection = session.document.selection;
    if (!selection) throw new SessionError("SELECTION_REQUIRED", "Select an area in the editor before reading pixel context.", 409);
    const x = Math.max(0, selection.x - padding);
    const y = Math.max(0, selection.y - padding);
    const right = Math.min(session.document.canvas.width, selection.x + selection.width + padding);
    const bottom = Math.min(session.document.canvas.height, selection.y + selection.height + padding);
    const width = right - x;
    const height = bottom - y;
    if (width * height > 65_536) {
      throw new SessionError("SELECTION_CONTEXT_TOO_LARGE", "Selection context exceeds 65,536 pixels. Select a smaller area.", 413);
    }
    const pixels = getPixels(session.document, selection.layerId, selection.frameId);
    const colorIndices = Array.from({ length: height }, (_row, row) => Array.from(
      { length: width },
      (_column, column) => pixels[(y + row) * session.document.canvas.width + x + column]!
    ));
    return {
      sessionId: id,
      documentId: session.document.id,
      revision: session.document.revision,
      ...(session.projectContext ? { projectContext: structuredClone(session.projectContext) } : {}),
      selection: structuredClone(selection),
      bounds: { x, y, width, height },
      palette: [...session.document.palette],
      colorIndices
    };
  }

  getMetadata(id: string): MetadataContext {
    const session = this.require(id);
    return {
      sessionId: id,
      document: {
        id: session.document.id,
        revision: session.document.revision,
        canvas: structuredClone(session.document.canvas),
        contentBounds: structuredClone(session.document.contentBounds),
        paletteSize: session.document.palette.length,
        layers: session.document.layers.map(({ id, name, visible, opacity }) => ({ id, name, visible, opacity })),
        frames: session.document.frames.map(({ id, name, durationMs, lighting }) => ({
          id,
          name,
          durationMs,
          lightingKeyframe: Boolean(lighting)
        }))
      },
      project: session.project
        ? {
          id: session.project.id,
          name: session.project.name,
          revision: session.project.revision,
          sourceCount: session.project.sources.length,
          clips: session.project.clips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            frameIds: [...clip.frameIds]
          })),
          ...(session.project.active ? { active: structuredClone(session.project.active) } : {})
        }
        : null,
      ...(session.document.selection ? { selection: structuredClone(session.document.selection) } : {})
    };
  }

  getDesignContext(
    id: string,
    options: { padding?: number; includeNormals?: boolean; bounds?: Rect } = {}
  ): DesignContext {
    const session = this.require(id);
    const padding = options.padding ?? 1;
    if (!Number.isInteger(padding) || padding < 0 || padding > 8) {
      throw new SessionError("PADDING_INVALID", "Design context padding must be an integer from 0 to 8.", 400);
    }
    const selection = session.document.selection;
    const layerId = selection?.layerId ?? session.projectContext?.layerId ?? session.document.layers[0]!.id;
    const frameId = selection?.frameId ?? session.projectContext?.frameId ?? session.document.frames[0]!.id;
    const sourceBounds = options.bounds ?? selection ?? session.document.contentBounds;
    if (options.bounds && !validBounds(options.bounds, session.document.canvas)) {
      throw new SessionError("BOUNDS_INVALID", "Design context bounds must stay inside the canvas.", 400);
    }
    const bounds = paddedBounds(sourceBounds, session.document.canvas, padding);
    if (bounds.width * bounds.height > 65_536) {
      throw new SessionError(
        "DESIGN_CONTEXT_TOO_LARGE",
        "Design context exceeds 65,536 pixels. Set a smaller selection or explicit bounds.",
        413
      );
    }
    const pixels = getPixels(session.document, layerId, frameId);
    const colorIndices = matrixFromPixels(pixels, session.document.canvas.width, bounds);
    const normals = options.includeNormals ? getNormalPixels(session.document, layerId, frameId) : undefined;
    return {
      sessionId: id,
      documentId: session.document.id,
      revision: session.document.revision,
      ...(session.projectContext ? { projectContext: structuredClone(session.projectContext) } : {}),
      target: { layerId, frameId },
      ...(selection ? { selection: structuredClone(selection) } : {}),
      bounds,
      palette: [...session.document.palette],
      colorIndices,
      ...(normals ? { normalValues: matrixFromPixels(normals, session.document.canvas.width, bounds) } : {})
    };
  }

  getPaletteContext(id: string): PaletteContext {
    const session = this.require(id);
    const layerId = session.document.selection?.layerId ?? session.projectContext?.layerId ?? session.document.layers[0]!.id;
    const frameId = session.document.selection?.frameId ?? session.projectContext?.frameId ?? session.document.frames[0]!.id;
    const counts = Array.from({ length: session.document.palette.length }, () => 0);
    for (const colorIndex of getPixels(session.document, layerId, frameId)) counts[colorIndex] = (counts[colorIndex] ?? 0) + 1;
    return {
      sessionId: id,
      revision: session.document.revision,
      target: { layerId, frameId },
      transparentColorIndex: session.document.transparentColorIndex,
      colors: session.document.palette.map((rgba, index) => ({
        index,
        rgba,
        usedPixels: counts[index]!,
        transparent: index === session.document.transparentColorIndex
      }))
    };
  }

  getMotionContext(id: string): MotionContext {
    const session = this.require(id);
    const clips = session.project?.clips ?? [{
      id: "all-frames",
      name: "All Frames",
      frameIds: session.document.frames.map((frame) => frame.id)
    }];
    return {
      sessionId: id,
      revision: session.document.revision,
      ...(session.projectContext?.clipId || clips[0]?.id
        ? { activeClipId: session.projectContext?.clipId ?? clips[0]!.id }
        : {}),
      clips: clips.map((clip) => ({
        id: clip.id,
        name: clip.name,
        durationMs: clip.frameIds.reduce((total, frameId) => (
          total + (session.document.frames.find((frame) => frame.id === frameId)?.durationMs ?? 0)
        ), 0),
        frames: clip.frameIds.map((frameId) => {
          const frame = session.document.frames.find((candidate) => candidate.id === frameId)!;
          return {
            id: frame.id,
            name: frame.name,
            durationMs: frame.durationMs,
            lightingKeyframe: Boolean(frame.lighting),
            ...(frame.lightingInterpolation ? { lightingInterpolation: frame.lightingInterpolation } : {}),
            resolvedLighting: resolveFrameLighting(session.document, clip.frameIds, frame.id)
          };
        })
      }))
    };
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

  async applyPatch(
    id: string,
    patchOrId: Patch | string,
    actor: EditActor = "user",
    client?: string
  ): Promise<SessionSnapshot> {
    const session = this.require(id);
    await this.assertFileUnchanged(session);
    return this.applyVerifiedPatch(session, patchOrId, actor, client);
  }

  private async applyVerifiedPatch(
    session: SessionRecord,
    patchOrId: Patch | string,
    actor: EditActor,
    client?: string,
    projectOverride?: PixelProject
  ): Promise<SessionSnapshot> {
    const patch = typeof patchOrId === "string" ? session.pending.get(patchOrId)?.patch : patchOrId;
    if (!patch) throw new SessionError("PATCH_NOT_FOUND", "Preview the patch again before applying it.", 404);
    assertPatchLimit(patch);
    assertActiveSelection(session, patch);
    const beforeDocument = structuredClone(session.document);
    const beforeProject = session.project ? structuredClone(session.project) : undefined;
    session.document = applyPatch(session.document, patch);
    if (session.project) {
      session.project = synchronizeProjectRevision(projectOverride ?? session.project, session.document, session.projectContext);
      session.document = structuredClone(session.project.document);
      session.projectContext = contextFromProject(session.project, session.projectContext);
    }
    session.history.record({
      beforeDocument,
      afterDocument: session.document,
      beforeProject,
      afterProject: session.project,
      patch,
      actor,
      client
    });
    session.pending.delete(patch.id);
    await this.persist(session);
    return snapshot(session);
  }

  async executeBatch(
    id: string,
    input: { operations: unknown[]; reason: string; baseRevision: number; actor?: EditActor; client?: string }
  ): Promise<SessionSnapshot & { mutation: MutationSummary }> {
    const session = this.require(id);
    const base = input.baseRevision;
    const assertBase = () => {
      if (!Number.isInteger(base) || base !== session.document.revision) {
        throw new SessionError("REVISION_CONFLICT", "The base revision changed. Read current context before retrying.", 409);
      }
    };
    assertBase();
    if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > 256) {
      throw new SessionError("BATCH_INVALID", "Provide between 1 and 256 operations.", 400);
    }
    await this.assertFileUnchanged(session);
    assertBase();
    const initial = structuredClone(session.document);
    let document = structuredClone(initial);
    let project = session.project ? structuredClone(session.project) : undefined;
    const operations = input.operations.map((value) => value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {});
    const counts = new Map<unknown, number>();
    for (const operation of operations) counts.set(operation.id, (counts.get(operation.id) ?? 0) + 1);
    const completed = new Map<string, EditItemResult["status"]>();
    const results: MutationSummary["results"] = [];
    for (const [index, operation] of operations.entries()) {
      const operationId = typeof operation.id === "string" ? operation.id : undefined;
      const result: MutationSummary["results"][number] = { index, ...(operationId ? { id: operationId } : {}), status: "failed" };
      try {
        if (!operationId || operationId.length > 128) throw new Error("INVALID_ID: Operation IDs must be nonempty strings of at most 128 characters.");
        if (counts.get(operationId)! > 1) throw new Error("DUPLICATE_ID: Operation IDs must be unique.");
        if (operation.dependsOn !== undefined) {
          if (!Array.isArray(operation.dependsOn) || operation.dependsOn.some((dependency) => typeof dependency !== "string")) {
            throw new Error("INVALID_DEPENDENCY: dependsOn must contain operation IDs.");
          }
          if (operation.dependsOn.some((dependency) => !["applied", "noop"].includes(completed.get(dependency) ?? ""))) {
            result.status = "skipped";
            throw new Error("DEPENDENCY_FAILED: Dependencies must precede this item and complete successfully.");
          }
        }
        if (typeof operation.validationError === "string") throw new Error(`ACTION_INVALID: ${operation.validationError}`);
        if (!operation.action || typeof operation.action !== "object" || Array.isArray(operation.action)) throw new Error("ACTION_INVALID: An action object is required.");
        const action = operation.action as EditablePixelAction;
        const fallback = { layerId: session.projectContext?.layerId ?? document.layers[0]!.id, frameId: session.projectContext?.frameId ?? document.frames[0]!.id };
        result.target = action.type === "remap_colors"
          ? action.selectionOnly ? { scope: "selection", layerId: document.selection?.layerId, frameId: document.selection?.frameId } : { scope: "targets", targets: action.targets }
          : isProjectAction(action) ? { projectId: project?.id } : {
            layerId: "layerId" in action ? action.layerId ?? fallback.layerId : document.selection?.layerId ?? fallback.layerId,
            frameId: "frameId" in action ? action.frameId ?? fallback.frameId : document.selection?.frameId ?? fallback.frameId
          };
        let next = document;
        let nextProject = project;
        if (isProjectAction(action)) {
          if (!project) throw new Error("PROJECT_REQUIRED: This operation requires a Project.");
          nextProject = applyProjectAction(project, action);
          nextProject.revision = project.revision;
          nextProject.updatedAt = project.updatedAt;
        } else {
          const remapped = action.type === "remap_colors" ? createRemapColorsPatch(document, action, input.reason) : undefined;
          const patch = remapped?.patch ?? createActionPatch(document, action, input.reason, fallback);
          assertPatchLimit(patch);
          assertActiveSelection({ ...session, document }, patch);
          next = applyPatch(document, patch);
          next.revision = document.revision;
          next.metadata.modifiedBy = document.metadata.modifiedBy;
          if (project) nextProject = synchronizeProjectDocument(project, next, session.projectContext);
          if (remapped) {
            result.items = remapped.results;
            if (remapped.results.some((item) => item.status === "failed")) result.status = remapped.changedPixels > 0 ? "partial" : "failed";
            else result.status = remapped.changedPixels > 0 ? "applied" : "noop";
          }
        }
        const changed = JSON.stringify(next) !== JSON.stringify(document) || JSON.stringify(nextProject) !== JSON.stringify(project);
        if (!result.items) result.status = changed ? "applied" : "noop";
        document = next;
        project = nextProject;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const separator = message.indexOf(": ");
        result.code = separator > 0 && /^[A-Z_]+$/.test(message.slice(0, separator)) ? message.slice(0, separator) : "ACTION_INVALID";
        result.message = separator > 0 && result.code !== "ACTION_INVALID" ? message.slice(separator + 2) : message;
      }
      results.push(result);
      if (operationId) completed.set(operationId, result.status);
    }
    const committed = JSON.stringify(document) !== JSON.stringify(initial) || JSON.stringify(project) !== JSON.stringify(session.project);
    let changedPixels = 0;
    for (const layer of initial.layers) for (const [frameId, pixels] of Object.entries(layer.frames)) {
      const after = document.layers.find((candidate) => candidate.id === layer.id)?.frames[frameId];
      changedPixels += pixels.filter((pixel, index) => after?.[index] !== pixel).length;
    }
    assertBase();
    const state = committed
      ? await this.applyVerifiedPatch(session, createDocumentPatch(initial, document, input.reason), input.actor ?? "ai", input.client ?? "mcp", project)
      : snapshot(session);
    return { ...state, mutation: { baseRevision: base, revision: state.revision, committed, changedPixels, results } };
  }

  async executeAction(
    id: string,
    input: { action: EditablePixelAction; reason: string; baseRevision?: number; actor?: EditActor; client?: string }
  ): Promise<SessionSnapshot> {
    const session = this.require(id);
    if (input.action?.type === "remap_colors" || input.baseRevision !== undefined) {
      return this.executeBatch(id, { ...input, baseRevision: input.baseRevision ?? session.document.revision, operations: [{ id: "action", action: input.action }] });
    }
    try {
      if (isProjectAction(input.action)) {
        if (!session.project) {
          throw new SessionError("PROJECT_REQUIRED", `${input.action.type} requires a Pixel Project session.`, 409);
        }
        await this.assertFileUnchanged(session);
        const beforeDocument = structuredClone(session.document);
        const beforeProject = structuredClone(session.project);
        const patch = createDocumentPatch(session.document, structuredClone(session.document), input.reason);
        const nextDocument = applyPatch(session.document, patch);
        const nextProject = applyProjectAction(session.project, input.action);
        nextProject.document = structuredClone(nextDocument);
        session.document = nextDocument;
        session.project = synchronizeProjectDocument(nextProject, nextDocument, session.projectContext);
        session.projectContext = contextFromProject(session.project, session.projectContext);
        session.history.record({
          beforeDocument,
          afterDocument: session.document,
          beforeProject,
          afterProject: session.project,
          patch,
          actor: input.actor ?? "ai",
          client: input.client ?? "mcp"
        });
        await this.persist(session);
        return snapshot(session);
      }
      await this.assertFileUnchanged(session);
      const fallback = {
        layerId: session.projectContext?.layerId ?? session.document.layers[0]!.id,
        frameId: session.projectContext?.frameId ?? session.document.frames[0]!.id
      };
      const patch = createActionPatch(session.document, input.action, input.reason, fallback);
      return await this.applyVerifiedPatch(session, patch, input.actor ?? "ai", input.client ?? "mcp");
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError(
        "ACTION_INVALID",
        error instanceof Error ? error.message : "The requested Editable Pixel action is invalid.",
        400
      );
    }
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
    const restored = session.history.undo(session.document, session.project);
    session.document = restored.document;
    if (restored.project) session.project = restored.project;
    if (session.project) session.projectContext = contextFromProject(session.project, session.projectContext);
    await this.persist(session);
    return snapshot(session);
  }

  async redo(id: string): Promise<SessionSnapshot> {
    const session = this.require(id);
    await this.assertFileUnchanged(session);
    const restored = session.history.redo(session.document, session.project);
    session.document = restored.document;
    if (restored.project) session.project = restored.project;
    if (session.project) session.projectContext = contextFromProject(session.project, session.projectContext);
    await this.persist(session);
    return snapshot(session);
  }

  getHistory(id: string, limit = 50): { sessionId: string; canUndo: boolean; canRedo: boolean; entries: HistoryEntrySummary[] } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new SessionError("HISTORY_LIMIT_INVALID", "History limit must be an integer from 1 to 200.", 400);
    }
    const history = this.require(id).history;
    return {
      sessionId: id,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      entries: history.entries(limit)
    };
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
    if (session.projectPath && session.projectFingerprint) {
      const current = await fingerprint(session.projectPath);
      if (current !== session.projectFingerprint) {
        throw new SessionError(
          "FILE_CONFLICT",
          "The Project changed on disk. Reopen it before applying this patch.",
          409
        );
      }
    }
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
    if (session.project && session.projectPath) {
      const currentPath = await canonicalFile(session.projectPath);
      if (currentPath !== session.projectPath) {
        throw new SessionError("PATH_OUTSIDE_ALLOWED_ROOT", "The Project path changed unexpectedly.", 403);
      }
      const fileInfo = await lstat(currentPath);
      if (fileInfo.isSymbolicLink()) throw new SessionError("SYMLINK_REJECTED", "Symbol link Projects are not writable.", 403);
      const context = session.projectContext ?? contextFromProject(session.project);
      const nextProject = structuredClone(session.project);
      nextProject.document = structuredClone(session.document);
      nextProject.active = {
        clipId: context.clipId,
        frameId: context.frameId,
        layerId: context.layerId
      };
      assertPixelProject(nextProject);
      const temporary = join(dirname(currentPath), `.${basename(currentPath)}.${token(8)}.tmp`);
      await writeFile(temporary, serializePixelProject(nextProject), { mode: 0o600, flag: "wx" });
      await rename(temporary, currentPath);
      session.project = nextProject;
      session.projectContext = contextFromProject(nextProject, context);
      session.projectFingerprint = await fingerprint(currentPath);
      return;
    }
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

class SessionHistory {
  readonly #past: SessionHistoryEntry[] = [];
  readonly #future: SessionHistoryEntry[] = [];
  #sequence = 0;

  record(input: {
    beforeDocument: PixelDocument;
    afterDocument: PixelDocument;
    beforeProject?: PixelProject;
    afterProject?: PixelProject;
    patch: Patch;
    actor: EditActor;
    client?: string;
  }): void {
    this.#past.push({
      sequence: this.#sequence++,
      id: input.patch.id,
      actor: input.actor,
      ...(input.client ? { client: input.client } : {}),
      reason: input.patch.reason,
      createdAt: input.patch.createdAt,
      revisionBefore: input.beforeDocument.revision,
      revisionAfter: input.afterDocument.revision,
      ...(input.afterDocument.selection ? { selection: structuredClone(input.afterDocument.selection) } : {}),
      beforeDocument: structuredClone(input.beforeDocument),
      afterDocument: structuredClone(input.afterDocument),
      ...(input.beforeProject ? { beforeProject: structuredClone(input.beforeProject) } : {}),
      ...(input.afterProject ? { afterProject: structuredClone(input.afterProject) } : {})
    });
    this.#future.length = 0;
  }

  undo(document: PixelDocument, project?: PixelProject): { document: PixelDocument; project?: PixelProject } {
    const entry = this.#past.pop();
    if (!entry) return { document, ...(project ? { project } : {}) };
    this.#future.push(entry);
    const restoredDocument = structuredClone(entry.beforeDocument);
    restoredDocument.revision = document.revision + 1;
    restoredDocument.metadata.modifiedBy = "editable-pixel-undo";
    assertPixelDocument(restoredDocument);
    const restoredProject = entry.beforeProject
      ? restoreProjectRevision(entry.beforeProject, project, restoredDocument)
      : project
        ? synchronizeProjectDocument(project, restoredDocument)
        : undefined;
    return { document: restoredDocument, ...(restoredProject ? { project: restoredProject } : {}) };
  }

  redo(document: PixelDocument, project?: PixelProject): { document: PixelDocument; project?: PixelProject } {
    const entry = this.#future.pop();
    if (!entry) return { document, ...(project ? { project } : {}) };
    const restoredDocument = applyPatch(
      document,
      createDocumentPatch(document, entry.afterDocument, `Redo: ${entry.reason}`)
    );
    restoredDocument.metadata.modifiedBy = "editable-pixel-redo";
    const restoredProject = entry.afterProject
      ? restoreProjectRevision(entry.afterProject, project, restoredDocument)
      : project
        ? synchronizeProjectDocument(project, restoredDocument)
        : undefined;
    this.#past.push(entry);
    return { document: restoredDocument, ...(restoredProject ? { project: restoredProject } : {}) };
  }

  entries(limit: number): HistoryEntrySummary[] {
    const applied = this.#past.map((entry) => ({ entry, state: "applied" as const }));
    const undone = this.#future.map((entry) => ({ entry, state: "undone" as const }));
    return [...applied, ...undone]
      .sort((left, right) => right.entry.sequence - left.entry.sequence)
      .slice(0, limit)
      .map(({ entry, state }) => summaryHistoryEntry(entry, state));
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
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

function summaryHistoryEntry(
  entry: SessionHistoryEntry,
  state: HistoryEntrySummary["state"]
): HistoryEntrySummary {
  return {
    id: entry.id,
    actor: entry.actor,
    ...(entry.client ? { client: entry.client } : {}),
    reason: entry.reason,
    createdAt: entry.createdAt,
    revisionBefore: entry.revisionBefore,
    revisionAfter: entry.revisionAfter,
    state,
    ...(entry.selection ? { selection: structuredClone(entry.selection) } : {})
  };
}

function restoreProjectRevision(
  source: PixelProject,
  current: PixelProject | undefined,
  document: PixelDocument
): PixelProject {
  const restored = structuredClone(source);
  restored.document = structuredClone(document);
  if (current) restored.revision = current.revision;
  restored.updatedAt = new Date().toISOString();
  return synchronizeProjectDocument(restored, document);
}

function paddedBounds(
  source: Rect,
  canvas: PixelDocument["canvas"],
  padding: number
): Rect {
  const x = Math.max(0, source.x - padding);
  const y = Math.max(0, source.y - padding);
  const right = Math.min(canvas.width, source.x + source.width + padding);
  const bottom = Math.min(canvas.height, source.y + source.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

function validBounds(bounds: Rect, canvas: PixelDocument["canvas"]): boolean {
  return Number.isInteger(bounds.x)
    && Number.isInteger(bounds.y)
    && Number.isInteger(bounds.width)
    && Number.isInteger(bounds.height)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width >= 1
    && bounds.height >= 1
    && bounds.x + bounds.width <= canvas.width
    && bounds.y + bounds.height <= canvas.height;
}

function matrixFromPixels(pixels: readonly number[], canvasWidth: number, bounds: Rect): number[][] {
  return Array.from({ length: bounds.height }, (_row, row) => Array.from(
    { length: bounds.width },
    (_column, column) => pixels[(bounds.y + row) * canvasWidth + bounds.x + column]!
  ));
}

function synchronizeProjectDocument(
  project: PixelProject,
  document: PixelDocument,
  preferred?: SessionProjectContext
): PixelProject {
  const next = structuredClone(project);
  next.document = structuredClone(document);
  const frameIds = new Set(next.document.frames.map((frame) => frame.id));
  for (const source of next.sources) {
    if (source.frameIds) {
      const retained = source.frameIds.filter((frameId) => frameIds.has(frameId));
      if (retained.length) source.frameIds = retained;
      else delete source.frameIds;
    }
    if (source.frames) {
      const retained = source.frames.filter((frame) => frameIds.has(frame.frameId));
      if (retained.length) source.frames = retained;
      else delete source.frames;
    }
  }
  for (const clip of next.clips) clip.frameIds = clip.frameIds.filter((frameId) => frameIds.has(frameId));
  if (next.clips.length > 1) next.clips = next.clips.filter((clip) => clip.frameIds.length > 0);
  if (next.clips.length === 0) {
    next.clips.push({
      id: preferred?.clipId ?? `clip-${token(8)}`,
      name: preferred?.clipName ?? "Clip 1",
      frameIds: []
    });
  }
  const owner = new Set(next.clips.flatMap((clip) => clip.frameIds));
  const target = next.clips.find((clip) => clip.id === preferred?.clipId)
    ?? next.clips.find((clip) => clip.id === next.active?.clipId)
    ?? next.clips[0]!;
  for (const frameId of frameIds) {
    if (!owner.has(frameId)) target.frameIds.push(frameId);
  }
  for (const clip of next.clips) {
    if (clip.frameIds.length === 0) clip.frameIds.push(next.document.frames[0]!.id);
    if (!clip.frameIds.some((frameId) => next.document.frames.find((frame) => frame.id === frameId)?.lighting)) {
      const frame = next.document.frames.find((candidate) => candidate.id === clip.frameIds[0])!;
      frame.lighting = preferred?.frameId
        ? resolveFrameLighting(document, [...frameIds], preferred.frameId)
        : { ...DEFAULT_FRAME_LIGHTING };
      frame.lightingInterpolation = "hold";
    }
  }
  const activeClip = next.clips.find((clip) => clip.id === preferred?.clipId)
    ?? next.clips.find((clip) => clip.id === next.active?.clipId)
    ?? next.clips[0]!;
  const activeFrameId = activeClip.frameIds.includes(preferred?.frameId ?? "")
    ? preferred!.frameId
    : activeClip.frameIds.includes(next.active?.frameId ?? "")
      ? next.active!.frameId!
      : activeClip.frameIds[0]!;
  const activeLayerId = next.document.layers.some((layer) => layer.id === preferred?.layerId)
    ? preferred!.layerId
    : next.document.layers.some((layer) => layer.id === next.active?.layerId)
      ? next.active!.layerId!
      : next.document.layers[0]!.id;
  next.active = { clipId: activeClip.id, frameId: activeFrameId, layerId: activeLayerId };
  assertPixelProject(next);
  return next;
}

function synchronizeProjectRevision(
  project: PixelProject,
  document: PixelDocument,
  preferred?: SessionProjectContext
): PixelProject {
  const next = synchronizeProjectDocument(project, document, preferred);
  next.revision = project.revision + 1;
  next.updatedAt = new Date().toISOString();
  assertPixelProject(next);
  return next;
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
    createdAt: session.createdAt,
    ...(session.projectContext ? { projectContext: structuredClone(session.projectContext) } : {})
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
  return {
    ...summary(session),
    document: structuredClone(session.document),
    ...(session.project ? { project: projectState(session.project) } : {})
  };
}

function projectState(project: PixelProject): SessionProjectState {
  return {
    id: project.id,
    name: project.name,
    revision: project.revision,
    clips: project.clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      frameIds: [...clip.frameIds]
    })),
    ...(project.active ? { active: structuredClone(project.active) } : {}),
    sourceCount: project.sources.length
  };
}

function contextFromProject(
  project: PixelProject,
  preferred?: SessionProjectContext
): SessionProjectContext {
  const clip = project.clips.find((candidate) => candidate.id === project.active?.clipId)
    ?? project.clips.find((candidate) => candidate.id === preferred?.clipId)
    ?? project.clips[0]!;
  const frameId = clip.frameIds.includes(project.active?.frameId ?? "")
    ? project.active!.frameId!
    : clip.frameIds.includes(preferred?.frameId ?? "")
      ? preferred!.frameId
      : clip.frameIds[0]!;
  const layer = project.document.layers.find((candidate) => candidate.id === project.active?.layerId)
    ?? project.document.layers.find((candidate) => candidate.id === preferred?.layerId)
    ?? project.document.layers[0]!;
  return {
    projectId: project.id,
    projectName: project.name,
    projectRevision: project.revision,
    clipId: clip.id,
    clipName: clip.name,
    frameId,
    layerId: layer.id,
    layerName: layer.name
  };
}

function assertSessionProjectContext(context: SessionProjectContext, document: PixelDocument): void {
  const identifiers = [context.projectId, context.clipId, context.frameId, context.layerId];
  if (identifiers.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))) {
    throw new SessionError("PROJECT_CONTEXT_INVALID", "Project context IDs contain unsupported characters.", 400);
  }
  if (!Number.isInteger(context.projectRevision) || context.projectRevision < 0) {
    throw new SessionError("PROJECT_CONTEXT_INVALID", "Project revision must be a non-negative integer.", 400);
  }
  if (!document.frames.some((frame) => frame.id === context.frameId)) {
    throw new SessionError("PROJECT_CONTEXT_CONFLICT", "The active Frame is not part of the session document.", 409);
  }
  if (!document.layers.some((layer) => layer.id === context.layerId)) {
    throw new SessionError("PROJECT_CONTEXT_CONFLICT", "The active Layer is not part of the session document.", 409);
  }
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

/**
 * A session ID travels through argument vectors (`--session <id>`), URL queries and log lines,
 * unlike the auth tokens, which only ever move inside request bodies and headers. base64url
 * includes `-` and `_`, so a plain `token()` produced an ID starting with `-` about 1 time in 64,
 * and an argument parser then read it as an option flag. The leading byte is redrawn until it maps
 * to an alphanumeric base64url digit; every other position keeps the full 64-symbol alphabet, and
 * the length is unchanged, so this costs log2(64/62) ~= 0.046 bits out of 144.
 */
export function createSessionId(bytes = 18): string {
  for (;;) {
    const candidate = token(bytes);
    if (/^[A-Za-z0-9]/.test(candidate)) return candidate;
  }
}
