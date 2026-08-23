import type { PixelDocument } from "@editable-pixel/document";

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

export interface Variant {
  id: string;
  name: string;
  document: PixelDocument;
  appliedSettings: ConvertSettings;
  hasEditsSinceConversion: boolean;
  createdAt: string;
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
  variants: Variant[];
}

export type InspectorTab = "convert" | "edit" | "frames";

type StoredSourceAsset = Omit<SourceAsset, "sourceUrl" | "sourceFrames"> & {
  sourceFrames?: Array<Omit<SourceFrameAsset, "sourceUrl">>;
};

export interface WorkspaceSnapshot {
  version: 1;
  draftSettings: ConvertSettings;
  workingDocument?: PixelDocument;
  sources: StoredSourceAsset[];
  activeSourceId?: string;
  activeVariantId?: string;
  activeInspectorTab: InspectorTab;
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
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.addEventListener("success", () => resolve(request.result as WorkspaceSnapshot | undefined));
    request.addEventListener("error", () => reject(request.error));
  });
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

function normalizeSettings(settings: ConvertSettings): ConvertSettings {
  return {
    ...settings,
    ...(settings.palette ? { palette: [...settings.palette].map((color) => color.toLowerCase()) } : {})
  };
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
