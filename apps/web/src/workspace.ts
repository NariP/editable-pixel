import type { PixelDocument } from "@editable-pixel/document";
import {
  createPixelProject,
  type PixelProject,
  type ProjectClip,
  type ProjectSource
} from "@editable-pixel/project";

export interface ConvertSettings {
  canvasWidth: number;
  canvasHeight: number;
  colorCount: number;
  contentScale: number;
  alignment: "center" | "bottom-center";
  dithering: "none" | "floyd-steinberg";
  background: "alpha" | "solid" | "local-removal";
  palette?: string[];
}

export interface SourceFrameAsset {
  frameId: string;
  name: string;
  mimeType: string;
  sourceBlob: Blob;
  sourceUrl?: string;
}

export interface SourceAsset {
  id: string;
  name: string;
  mimeType: string;
  sourceBlob?: Blob;
  sourceUrl?: string;
  sourceFrames?: SourceFrameAsset[];
}

export type InspectorTab = "convert" | "edit" | "frames";

type StoredSourceAsset = Omit<SourceAsset, "sourceUrl" | "sourceFrames"> & {
  sourceFrames?: Array<Omit<SourceFrameAsset, "sourceUrl">>;
};

export interface WorkspaceSnapshot {
  version: 3;
  project: PixelProject;
  draftSettings: ConvertSettings;
  sources: StoredSourceAsset[];
  activeSourceId?: string;
  activeInspectorTab: InspectorTab;
  savedRevision?: number;
}

export interface RecentProjectSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
}

interface LegacyVariant {
  id: string;
  name: string;
  document: PixelDocument;
  appliedSettings: ConvertSettings;
  hasEditsSinceConversion: boolean;
  createdAt: string;
}

interface LegacySourceAsset {
  id: string;
  name: string;
  mimeType: string;
  sourceBlob?: Blob;
  sourceFrames?: Array<Omit<SourceFrameAsset, "sourceUrl">>;
  variants: LegacyVariant[];
}

interface LegacyWorkspaceSnapshot {
  version: 1;
  draftSettings: ConvertSettings;
  workingDocument?: PixelDocument;
  sources: LegacySourceAsset[];
  activeSourceId?: string;
  activeVariantId?: string;
  activeInspectorTab: InspectorTab;
}

interface AssetWorkspaceSnapshot {
  version: 2;
  project: {
    format: "pixel-project";
    version: 1;
    id: string;
    name: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    assets: Array<{
      id: string;
      name: string;
      sources: ProjectSource[];
      document: PixelDocument;
      clips: ProjectClip[];
    }>;
    active?: { assetId: string; clipId?: string; frameId?: string; layerId?: string };
  };
  draftSettings: ConvertSettings;
  sources: Array<StoredSourceAsset & { assetId: string }>;
  activeSourceId?: string;
  activeInspectorTab: InspectorTab;
  savedRevision?: number;
}

const DATABASE = "editable-pixel-workspaces";
const STORE = "sessions";

export function settingsEqual(left: ConvertSettings, right: ConvertSettings): boolean {
  return JSON.stringify(normalizeSettings(left)) === JSON.stringify(normalizeSettings(right));
}

export function cloneSettings(settings: ConvertSettings): ConvertSettings {
  return structuredClone(settings);
}

export function createWorkspaceKey(sessionId?: string): string {
  if (sessionId) return `session:${sessionId}`;
  const storageKey = "editable-pixel-workspace-id";
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return `standalone:${existing}`;
  const id = crypto.randomUUID();
  sessionStorage.setItem(storageKey, id);
  return `standalone:${id}`;
}

export async function loadWorkspace(key: string): Promise<WorkspaceSnapshot | undefined> {
  if (!("indexedDB" in globalThis)) return undefined;
  const database = await openDatabase();
  const stored = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
  return migrateWorkspaceSnapshot(stored);
}

export async function saveWorkspace(key: string, snapshot: WorkspaceSnapshot): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(snapshot, key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

export async function listRecentProjects(): Promise<RecentProjectSummary[]> {
  if (!("indexedDB" in globalThis)) return [];
  const database = await openDatabase();
  const entries = await new Promise<Array<{ key: IDBValidKey; value: unknown }>>((resolve, reject) => {
    const collected: Array<{ key: IDBValidKey; value: unknown }> = [];
    const request = database.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) return resolve(collected);
      collected.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    });
    request.addEventListener("error", () => reject(request.error));
  });
  return entries.flatMap(({ key, value }): RecentProjectSummary[] => {
    if (typeof key !== "string" || !key.startsWith("project:")) return [];
    const snapshot = migrateWorkspaceSnapshot(value);
    if (!snapshot) return [];
    return [{
      id: snapshot.project.id,
      name: snapshot.project.name,
      revision: snapshot.project.revision,
      updatedAt: snapshot.project.updatedAt
    }];
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteRecentProject(projectId: string): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(`project:${projectId}`);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

export function migrateWorkspaceSnapshot(input: unknown): WorkspaceSnapshot | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as { version?: unknown };
  if (value.version === 3) return structuredClone(input) as WorkspaceSnapshot;
  if (value.version === 2) return migrateAssetWorkspace(input as AssetWorkspaceSnapshot);
  if (value.version !== 1) return undefined;

  const legacy = input as LegacyWorkspaceSnapshot;
  const selectedSource = legacy.sources.find((source) => source.id === legacy.activeSourceId) ?? legacy.sources[0];
  const selectedVariant = selectedSource?.variants.find((variant) => variant.id === legacy.activeVariantId)
    ?? selectedSource?.variants[0];
  if (!selectedSource || !selectedVariant) {
    const project = createPixelProject({ document: legacy.workingDocument });
    return {
      version: 3,
      project,
      draftSettings: cloneSettings(legacy.draftSettings),
      sources: [],
      activeInspectorTab: normalizeInspectorTab(legacy.activeInspectorTab)
    };
  }

  const document = legacy.workingDocument && selectedSource.id === legacy.activeSourceId && selectedVariant.id === legacy.activeVariantId
    ? legacy.workingDocument
    : selectedVariant.document;
  const project = createPixelProject({ document, now: selectedVariant.createdAt });
  const runtimeSourceId = `source-${crypto.randomUUID()}`;
  project.sources = [{
    id: runtimeSourceId,
    name: selectedSource.name,
    kind: selectedSource.mimeType === "application/json" ? "pixel-json" : "image",
    mimeType: selectedSource.mimeType,
    createdAt: selectedVariant.createdAt
  }];

  return {
    version: 3,
    project,
    draftSettings: cloneSettings(selectedVariant.appliedSettings),
    sources: [{
      id: runtimeSourceId,
      name: selectedSource.name,
      mimeType: selectedSource.mimeType,
      ...(selectedSource.sourceBlob ? { sourceBlob: selectedSource.sourceBlob } : {}),
      ...(selectedSource.sourceFrames ? { sourceFrames: structuredClone(selectedSource.sourceFrames) } : {})
    }],
    activeSourceId: runtimeSourceId,
    activeInspectorTab: normalizeInspectorTab(legacy.activeInspectorTab)
  };
}

export function restoreSourceUrls(sources: WorkspaceSnapshot["sources"]): SourceAsset[] {
  return sources.map((source) => ({
    ...source,
    ...(source.sourceBlob ? { sourceUrl: URL.createObjectURL(source.sourceBlob) } : {}),
    ...(source.sourceFrames ? {
      sourceFrames: source.sourceFrames.map((frame) => ({
        ...frame,
        sourceUrl: URL.createObjectURL(frame.sourceBlob)
      }))
    } : {})
  }));
}

export async function restoreEmbeddedProjectSources(project: PixelProject): Promise<SourceAsset[]> {
  const restored: SourceAsset[] = [];
  for (const source of project.sources) {
      const sourceBlob = source.dataBase64
        ? await verifiedBlob(source.dataBase64, source.mimeType, source.digest, source.name)
        : undefined;
      const sourceFrames = source.frames
        ? await Promise.all(source.frames.map(async (frame) => {
          const sourceBlob = await verifiedBlob(frame.dataBase64, frame.mimeType, frame.digest, frame.name);
          return {
            frameId: frame.frameId,
            name: frame.name,
            mimeType: frame.mimeType,
            sourceBlob,
            sourceUrl: URL.createObjectURL(sourceBlob)
          } satisfies SourceFrameAsset;
        }))
        : sourceBlob && source.mimeType.startsWith("image/")
          ? (source.frameIds ?? [project.document.frames[0]!.id]).map((frameId) => ({
            frameId,
            name: source.name,
            mimeType: source.mimeType,
            sourceBlob,
            sourceUrl: URL.createObjectURL(sourceBlob)
          }))
          : undefined;
      restored.push({
        id: source.id,
        name: source.name,
        mimeType: source.mimeType,
        ...(sourceBlob ? { sourceBlob } : {}),
        ...(sourceBlob && source.mimeType.startsWith("image/") ? { sourceUrl: URL.createObjectURL(sourceBlob) } : {}),
        ...(sourceFrames ? { sourceFrames } : {})
      });
  }
  return restored;
}

function migrateAssetWorkspace(legacy: AssetWorkspaceSnapshot): WorkspaceSnapshot | undefined {
  const selectedAsset = legacy.project.assets.find((asset) => asset.id === legacy.project.active?.assetId)
    ?? legacy.project.assets[0];
  if (!selectedAsset) return undefined;
  const selectedClip = selectedAsset.clips.find((clip) => clip.id === legacy.project.active?.clipId)
    ?? selectedAsset.clips[0]!;
  const project: PixelProject = {
    format: "pixel-project",
    version: 1,
    id: legacy.project.id,
    name: legacy.project.name,
    revision: legacy.project.revision,
    createdAt: legacy.project.createdAt,
    updatedAt: legacy.project.updatedAt,
    sources: structuredClone(selectedAsset.sources),
    document: structuredClone(selectedAsset.document),
    clips: structuredClone(selectedAsset.clips),
    active: {
      clipId: selectedClip.id,
      frameId: selectedClip.frameIds.includes(legacy.project.active?.frameId ?? "")
        ? legacy.project.active!.frameId
        : selectedClip.frameIds[0]!,
      layerId: selectedAsset.document.layers.some((layer) => layer.id === legacy.project.active?.layerId)
        ? legacy.project.active!.layerId
        : selectedAsset.document.layers[0]!.id
    }
  };
  const sources = legacy.sources
    .filter((source) => source.assetId === selectedAsset.id)
    .map(({ assetId, ...source }) => {
      void assetId;
      return structuredClone(source);
    });
  return {
    version: 3,
    project,
    draftSettings: cloneSettings(legacy.draftSettings),
    sources,
    ...(sources.some((source) => source.id === legacy.activeSourceId) ? { activeSourceId: legacy.activeSourceId } : {}),
    activeInspectorTab: normalizeInspectorTab(legacy.activeInspectorTab),
    ...(legacy.savedRevision === undefined ? {} : { savedRevision: legacy.savedRevision })
  };
}

function normalizeSettings(settings: ConvertSettings): ConvertSettings {
  return {
    ...settings,
    ...(settings.palette ? { palette: [...settings.palette].map((color) => color.toLowerCase()) } : {})
  };
}

function normalizeInspectorTab(tab: string): InspectorTab {
  return tab === "edit" || tab === "frames" ? tab : "convert";
}

async function verifiedBlob(dataBase64: string, mimeType: string, digest: string | undefined, name: string): Promise<Blob> {
  let binary: string;
  try {
    binary = atob(dataBase64);
  } catch {
    throw new Error(`The embedded source ${name} is not valid base64 data.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (digest) {
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes) as unknown as BufferSource))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (actual !== digest) throw new Error(`The retained source ${name} failed its SHA-256 integrity check.`);
  }
  return new Blob([Uint8Array.from(bytes)], { type: mimeType });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}
