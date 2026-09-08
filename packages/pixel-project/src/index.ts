import {
  DEFAULT_FRAME_LIGHTING,
  createPixelDocument,
  validatePixelDocument,
  type PixelDocument
} from "@editable-pixel/document";
import { Value } from "@sinclair/typebox/value";

import { PixelProjectSchema, type PixelProject } from "./schema.js";

export * from "./schema.js";

export interface ProjectValidationIssue {
  path: string;
  message: string;
}

export interface ProjectValidationResult {
  valid: boolean;
  issues: ProjectValidationIssue[];
}

export type ProjectSaveStatus =
  | "saving"
  | "saved"
  | "reconnecting"
  | "unsaved"
  | "failed"
  | "conflict";

export interface ProjectSaveState {
  status: ProjectSaveStatus;
  savedRevision: number;
  pendingRevision?: number;
  error?: string;
}

export interface PersistedProject {
  revision: number;
}

export type ProjectPersister = (
  project: PixelProject,
  expectedRevision: number
) => Promise<PersistedProject>;

export function createPixelProject(options: {
  id?: string;
  name?: string;
  clipId?: string;
  document?: PixelDocument;
  width?: number;
  height?: number;
  now?: string;
} = {}): PixelProject {
  const now = options.now ?? new Date().toISOString();
  const document = ensureFrameLighting(options.document ?? createPixelDocument({
    width: options.width ?? 64,
    height: options.height ?? 64
  }));
  const clipId = options.clipId ?? randomIdentifier("clip");
  const project: PixelProject = {
    format: "pixel-project",
    version: 1,
    id: options.id ?? randomIdentifier("project"),
    name: options.name ?? "Untitled Project",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    sources: [],
    document,
    clips: [{ id: clipId, name: "Clip 1", frameIds: document.frames.map((frame) => frame.id) }],
    active: {
      clipId,
      frameId: document.frames[0]!.id,
      layerId: document.layers[0]!.id
    }
  };
  assertPixelProject(project);
  return project;
}

export function createProjectFromPixelDocument(
  document: PixelDocument,
  options: { id?: string; name?: string; now?: string } = {}
): PixelProject {
  return createPixelProject({ ...options, document });
}

export function clonePixelProject(
  project: PixelProject,
  options: { id?: string; name: string; now?: string }
): PixelProject {
  assertPixelProject(project);
  const now = options.now ?? new Date().toISOString();
  const clone = structuredClone(project);
  clone.id = options.id ?? randomIdentifier("project");
  clone.name = options.name;
  clone.revision = 0;
  clone.createdAt = now;
  clone.updatedAt = now;
  assertPixelProject(clone);
  return clone;
}

export function commitPixelProject(
  project: PixelProject,
  mutate: (draft: PixelProject) => void,
  now = new Date().toISOString()
): PixelProject {
  assertPixelProject(project);
  const next = structuredClone(project);
  mutate(next);
  next.revision = project.revision + 1;
  next.updatedAt = now;
  assertPixelProject(next);
  return next;
}

export function validatePixelProject(input: unknown): ProjectValidationResult {
  const issues: ProjectValidationIssue[] = [];
  if (!Value.Check(PixelProjectSchema, input)) {
    for (const error of Value.Errors(PixelProjectSchema, input)) {
      issues.push({ path: error.path || "/", message: error.message });
    }
    return { valid: false, issues };
  }

  const project = input as PixelProject;
  validateProjectContents(project, issues);

  if (project.active) {
    const clip = project.active.clipId
      ? project.clips.find((candidate) => candidate.id === project.active!.clipId)
      : undefined;
    if (project.active.clipId && !clip) {
      issues.push({ path: "/active/clipId", message: "Active clip must belong to the Project." });
    }
    if (project.active.frameId && !project.document.frames.some((frame) => frame.id === project.active!.frameId)) {
      issues.push({ path: "/active/frameId", message: "Active frame must belong to the Project." });
    }
    if (project.active.frameId && clip && !clip.frameIds.includes(project.active.frameId)) {
      issues.push({ path: "/active/frameId", message: "Active frame must belong to the active clip." });
    }
    if (project.active.layerId && !project.document.layers.some((layer) => layer.id === project.active!.layerId)) {
      issues.push({ path: "/active/layerId", message: "Active layer must belong to the Project." });
    }
  }
  return { valid: issues.length === 0, issues };
}

export function assertPixelProject(input: unknown): asserts input is PixelProject {
  const result = validatePixelProject(input);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Invalid Pixel Project:\n${detail}`);
  }
}

export function parsePixelProject(input: string | unknown): PixelProject {
  const decoded: unknown = typeof input === "string" ? JSON.parse(input) : input;
  assertPixelProject(decoded);
  return structuredClone(decoded);
}

export function serializePixelProject(project: PixelProject, pretty = true): string {
  assertPixelProject(project);
  return canonicalStringify(project, pretty ? 2 : 0);
}

export class ProjectRevisionConflictError extends Error {
  constructor(message = "The project revision changed before it could be saved.") {
    super(message);
    this.name = "ProjectRevisionConflictError";
  }
}

export class ProjectUnavailableError extends Error {
  constructor(message = "The local project store is unavailable.") {
    super(message);
    this.name = "ProjectUnavailableError";
  }
}

export class ProjectAutosaveQueue {
  #state: ProjectSaveState;
  #pending?: PixelProject;
  #inFlightRevision?: number;
  #drainPromise?: Promise<void>;
  #listeners = new Set<(state: ProjectSaveState) => void>();

  constructor(
    private readonly persist: ProjectPersister,
    savedRevision: number
  ) {
    this.#state = { status: "saved", savedRevision };
  }

  get state(): ProjectSaveState {
    return { ...this.#state };
  }

  subscribe(listener: (state: ProjectSaveState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  enqueue(project: PixelProject): void {
    assertPixelProject(project);
    const newestRevision = Math.max(
      this.#state.savedRevision,
      this.#pending?.revision ?? this.#state.savedRevision,
      this.#inFlightRevision ?? this.#state.savedRevision
    );
    if (project.revision === newestRevision) return;
    if (project.revision < newestRevision) {
      throw new Error(`Autosave revisions must increase. Received ${project.revision} after ${newestRevision}.`);
    }
    this.#pending = structuredClone(project);
    this.update({
      status: this.#state.status === "conflict" ? "conflict" : "unsaved",
      ...(this.#state.error ? { error: this.#state.error } : {}),
      savedRevision: this.#state.savedRevision,
      pendingRevision: project.revision
    });
    if (this.#state.status !== "conflict") this.start();
  }

  retry(): void {
    if (!this.#pending || this.#state.status === "conflict") return;
    this.start();
  }

  async flush(): Promise<ProjectSaveState> {
    while (this.#drainPromise) await this.#drainPromise;
    return this.state;
  }

  private start(): void {
    if (this.#drainPromise || !this.#pending) return;
    this.#drainPromise = this.drain().finally(() => {
      this.#drainPromise = undefined;
    });
  }

  private async drain(): Promise<void> {
    while (this.#pending) {
      const candidate = this.#pending;
      this.#pending = undefined;
      this.#inFlightRevision = candidate.revision;
      this.update({
        status: "saving",
        savedRevision: this.#state.savedRevision,
        pendingRevision: candidate.revision
      });
      try {
        const persisted = await this.persist(structuredClone(candidate), this.#state.savedRevision);
        if (persisted.revision !== candidate.revision) {
          throw new Error(`Project store acknowledged revision ${persisted.revision}, expected ${candidate.revision}.`);
        }
        this.update({ status: "saved", savedRevision: persisted.revision });
      } catch (error) {
        const queuedDuringSave = this.pendingSnapshot();
        this.#pending = !queuedDuringSave || queuedDuringSave.revision < candidate.revision
          ? candidate
          : queuedDuringSave;
        const status = error instanceof ProjectRevisionConflictError
          ? "conflict"
          : error instanceof ProjectUnavailableError
            ? "reconnecting"
            : "failed";
        this.update({
          status,
          savedRevision: this.#state.savedRevision,
          pendingRevision: this.#pending.revision,
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      } finally {
        this.#inFlightRevision = undefined;
      }
    }
  }

  private update(state: ProjectSaveState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(this.state);
  }

  private pendingSnapshot(): PixelProject | undefined {
    return this.#pending;
  }
}

function validateProjectContents(
  project: PixelProject,
  issues: ProjectValidationIssue[]
): void {
  const sourceIds = new Set<string>();
  for (const [sourceIndex, source] of project.sources.entries()) {
    if (sourceIds.has(source.id)) {
      issues.push({ path: "/sources", message: "Source IDs must be unique within a Project." });
    }
    sourceIds.add(source.id);
    if (source.dataBase64 && !source.digest) {
      issues.push({
        path: `/sources/${sourceIndex}/digest`,
        message: "Embedded source data must include its SHA-256 digest."
      });
    }
  }

  const documentResult = validatePixelDocument(project.document);
  for (const issue of documentResult.issues) {
    issues.push({ path: `/document${issue.path}`, message: issue.message });
  }
  const frameIds = new Set(project.document.frames.map((frame) => frame.id));
  for (const [sourceIndex, source] of project.sources.entries()) {
    const boundFrameIds = [
      ...source.frameIds ?? [],
      ...source.frames?.map((frame) => frame.frameId) ?? []
    ];
    const seenFrameIds = new Set<string>();
    for (const frameId of boundFrameIds) {
      if (!frameIds.has(frameId)) {
        issues.push({
          path: `/sources/${sourceIndex}`,
          message: `Source frame ${frameId} must belong to the Project.`
        });
      }
      if (seenFrameIds.has(frameId)) {
        issues.push({
          path: `/sources/${sourceIndex}`,
          message: `Source frame ${frameId} must not be bound more than once.`
        });
      }
      seenFrameIds.add(frameId);
    }
  }
  const clipIds = new Set<string>();
  const frameOwners = new Map<string, string>();
  const framesById = new Map(project.document.frames.map((frame) => [frame.id, frame]));
  for (const [clipIndex, clip] of project.clips.entries()) {
    if (clipIds.has(clip.id)) {
      issues.push({ path: "/clips", message: "Clip IDs must be unique within a Project." });
    }
    clipIds.add(clip.id);
    if (new Set(clip.frameIds).size !== clip.frameIds.length) {
      issues.push({ path: `/clips/${clipIndex}/frameIds`, message: "Clip frame IDs must be unique." });
    }
    for (const frameId of clip.frameIds) {
      if (!frameIds.has(frameId)) {
        issues.push({ path: `/clips/${clipIndex}/frameIds`, message: "Clip references an unknown frame." });
        continue;
      }
      const owner = frameOwners.get(frameId);
      if (owner && owner !== clip.id) {
        issues.push({ path: `/clips/${clipIndex}/frameIds`, message: "A frame may belong to only one clip." });
      }
      frameOwners.set(frameId, clip.id);
    }
    if (!clip.frameIds.some((frameId) => framesById.get(frameId)?.lighting)) {
      issues.push({
        path: `/clips/${clipIndex}/frameIds`,
        message: "Every clip must keep at least one lighting keyframe."
      });
    }
  }
  for (const frameId of frameIds) {
    if (!frameOwners.has(frameId)) {
      issues.push({ path: "/clips", message: `Frame ${frameId} must belong to a clip.` });
    }
  }
}

function ensureFrameLighting(document: PixelDocument): PixelDocument {
  const next = structuredClone(document);
  if (!next.frames.some((frame) => frame.lighting)) {
    next.frames[0]!.lighting = { ...DEFAULT_FRAME_LIGHTING };
  }
  return next;
}

function randomIdentifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function canonicalStringify(value: unknown, space = 0): string {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)])
  );
}
