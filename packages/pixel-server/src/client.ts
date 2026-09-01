import type { Patch } from "@editable-pixel/core";
import type { PixelDocument, Selection } from "@editable-pixel/document";

import type { EditablePixelAction, SelectionCommand } from "./agent-actions.js";
import type { WebControlCommand } from "./web-actions.js";
import { readRegistry, type ServerRegistry } from "./registry.js";
import type {
  DesignContext,
  HistoryEntrySummary,
  MetadataContext,
  MotionContext,
  PaletteContext,
  SessionProjectContext,
  SessionSnapshot,
  SessionSummary
} from "./session-store.js";

export class PixelServerClient {
  constructor(
    private readonly registry: ServerRegistry,
    private readonly clientName = "cli"
  ) {}

  static async connect(clientName = "cli"): Promise<PixelServerClient> {
    const registry = await readRegistry();
    if (!registry) throw new ClientError("SERVER_NOT_RUNNING", "Run `editable-pixel open <document>` first.");
    const client = new PixelServerClient(registry, clientName);
    await client.request("/api/health");
    return client;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return (await this.request<{ sessions: SessionSummary[] }>("/api/sessions")).sessions;
  }

  createSession(body: {
    document?: PixelDocument;
    documentPath?: string;
    projectPath?: string;
    outputDirectory?: string;
    host?: "browser" | "codex" | "claude";
  }) {
    return this.request<{ session: SessionSnapshot; bootstrapToken: string; persistentToken: string }>(
      "/api/sessions",
      { method: "POST", body }
    );
  }

  getSession(id: string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`);
  }

  closeSession(id: string): Promise<{ closed: boolean; sessionId: string }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  getSelection(id: string): Promise<{ sessionId: string; selection: Selection | null }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/selection`);
  }

  getSelectionContext(id: string, padding = 1): Promise<{
    sessionId: string;
    documentId: string;
    revision: number;
    projectContext?: SessionProjectContext;
    selection: Selection;
    bounds: { x: number; y: number; width: number; height: number };
    palette: string[];
    colorIndices: number[][];
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/selection-context?padding=${padding}`);
  }

  getProjectContext(id: string): Promise<{ sessionId: string; context: SessionProjectContext | null }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/project-context`);
  }

  getMetadata(id: string): Promise<MetadataContext> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/metadata`);
  }

  getDesignContext(
    id: string,
    options: { padding?: number; includeNormals?: boolean; bounds?: { x: number; y: number; width: number; height: number } } = {}
  ): Promise<DesignContext> {
    const query = new URLSearchParams({
      padding: String(options.padding ?? 1),
      includeNormals: String(options.includeNormals ?? false)
    });
    if (options.bounds) query.set("bounds", [
      options.bounds.x,
      options.bounds.y,
      options.bounds.width,
      options.bounds.height
    ].join(","));
    return this.request(`/api/sessions/${encodeURIComponent(id)}/design-context?${query}`);
  }

  getPaletteContext(id: string): Promise<PaletteContext> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/palette-context`);
  }

  getMotionContext(id: string): Promise<MotionContext> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/motion-context`);
  }

  getHistory(id: string, limit = 50): Promise<{
    sessionId: string;
    canUndo: boolean;
    canRedo: boolean;
    entries: HistoryEntrySummary[];
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/history?limit=${limit}`);
  }

  setSelectionCommand(id: string, command: SelectionCommand): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/selection-command`, {
      method: "POST",
      body: { command }
    });
  }

  executeAction(id: string, action: EditablePixelAction, reason: string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      body: { action, reason }
    });
  }

  executeWebCommand<T = unknown>(id: string, command: WebControlCommand): Promise<{
    sessionId: string;
    result: T;
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/web-command`, {
      method: "POST",
      body: { command },
      timeoutMs: 65_000
    });
  }

  setProjectContext(id: string, context: SessionProjectContext): Promise<{ sessionId: string; context: SessionProjectContext }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/project-context`, {
      method: "POST", body: { context }
    });
  }

  previewPatch(id: string, patch: Patch): Promise<{ patch: Patch; before: PixelDocument; after: PixelDocument }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/patches/preview`, {
      method: "POST", body: { patch }
    });
  }

  createPatch(id: string, input: {
    layerId?: string;
    frameId?: string;
    reason: string;
    requireSelection?: boolean;
    newColors?: string[];
    changes: Array<{ x: number; y: number; colorIndex: number }>;
  }): Promise<{ patch: Patch }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/patches/create`, {
      method: "POST", body: input
    });
  }

  validateDocument(document: unknown): Promise<{ valid: boolean; issues: Array<{ path: string; message: string }> }> {
    return this.request("/api/validate", { method: "POST", body: { document } });
  }

  renderPreview(id: string, options: { scale?: number; frameId?: string } = {}): Promise<{
    mimeType: "image/png";
    data: string;
    width: number;
    height: number;
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/render-preview`, {
      method: "POST", body: options
    });
  }

  exportFrame(id: string, options: {
    filename: string;
    format?: "color" | "normal" | "lit";
    scale?: number;
    frameId?: string;
  }): Promise<{
    path: string;
    format: "color" | "normal" | "lit";
    frameId: string;
    mimeType: "image/png";
    width: number;
    height: number;
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/export-frame`, {
      method: "POST", body: options
    });
  }

  applyPatch(id: string, patchOrId: Patch | string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/patches/apply`, {
      method: "POST",
      body: typeof patchOrId === "string" ? { patchId: patchOrId } : { patch: patchOrId }
    });
  }

  rejectPatch(id: string, patchId: string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/patches/reject`, {
      method: "POST", body: { patchId }
    });
  }

  undo(id: string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/undo`, { method: "POST", body: {} });
  }

  redo(id: string): Promise<SessionSnapshot> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/redo`, { method: "POST", body: {} });
  }

  browserUrl(id: string, bootstrapToken: string): string {
    return `http://127.0.0.1:${this.registry.port}/?session=${encodeURIComponent(id)}&bootstrap=${encodeURIComponent(bootstrapToken)}`;
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${this.registry.port}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.registry.daemonToken}`,
          "X-Editable-Pixel-Client": this.clientName,
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000)
      });
    } catch {
      throw new ClientError("SERVER_UNREACHABLE", "The registered local server is not reachable. Start it again.");
    }
    const data = await response.json() as T | { error: { code: string; message: string } };
    if (!response.ok) {
      const failure = data as { error: { code: string; message: string } };
      throw new ClientError(failure.error.code, failure.error.message);
    }
    return data as T;
  }
}

export class ClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ClientError";
  }
}
