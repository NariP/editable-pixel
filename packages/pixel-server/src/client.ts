import type { Patch } from "@editable-pixel/core";
import type { PixelDocument, Selection } from "@editable-pixel/document";

import { readRegistry, type ServerRegistry } from "./registry.js";
import type { SessionSnapshot, SessionSummary } from "./session-store.js";

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

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
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
        signal: AbortSignal.timeout(5_000)
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
