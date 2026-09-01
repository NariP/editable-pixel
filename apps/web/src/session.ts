import type { Patch } from "@editable-pixel/core";
import type { PixelDocument } from "@editable-pixel/document";
import type { SessionProjectState, WebCommandEnvelope } from "@editable-pixel/server";
import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "standalone" | "connecting" | "connected" | "reconnecting" | "conflict";

export interface PendingPatch {
  patch: Patch;
  before: PixelDocument;
  after: PixelDocument;
}

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

interface SessionState {
  status: ConnectionStatus;
  clients: string[];
  host?: "browser" | "codex" | "claude";
  pendingPatch?: PendingPatch;
  projectContext?: SessionProjectContext;
  webCommands: WebCommandEnvelope[];
  pendingDocumentPatches: number;
}

export function usePixelSession(
  sessionId: string | undefined,
  onDocument: (document: PixelDocument, project?: SessionProjectState, projectChanged?: boolean) => void
): SessionState & {
  token?: string;
  sendSelection: (selection: PixelDocument["selection"]) => void;
  sendPatch: (patch: Patch, actor?: "user" | "ai") => void;
  sendContext: (context: SessionProjectContext) => void;
  decidePatch: (patchId: string, decision: "apply" | "reject") => void;
  requestUndo: () => void;
  requestRedo: () => void;
  completeWebCommand: (commandId: string, result: { ok: true; result?: unknown } | { ok: false; error: { message: string } }) => void;
} {
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const retryRef = useRef<number | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(undefined);
  const pendingPatchesRef = useRef<Patch[]>([]);
  const patchActorsRef = useRef(new Map<string, "user" | "ai">());
  const sentPatchIdsRef = useRef(new Set<string>());
  const deferredMessagesRef = useRef(new Map<string, unknown>());
  const readyToSendRef = useRef(false);
  const activeSessionRef = useRef<string | undefined>(sessionId);
  const [token, setToken] = useState<string>();
  const [state, setState] = useState<SessionState>({
    status: sessionId ? "connecting" : "standalone",
    clients: [],
    webCommands: [],
    pendingDocumentPatches: 0
  });

  useEffect(() => {
    if (activeSessionRef.current !== sessionId) {
      activeSessionRef.current = sessionId;
      pendingPatchesRef.current = [];
      patchActorsRef.current.clear();
      sentPatchIdsRef.current.clear();
      deferredMessagesRef.current.clear();
      readyToSendRef.current = false;
    }
    if (!sessionId) {
      setState({ status: "standalone", clients: [], webCommands: [], pendingDocumentPatches: 0 });
      return;
    }
    let disposed = false;
    let attempts = 0;
    const sendSocket = (message: unknown) => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
      socketRef.current.send(JSON.stringify(message));
      return true;
    };
    const flushPending = () => {
      if (!readyToSendRef.current) return;
      for (const patch of pendingPatchesRef.current) {
        if (sentPatchIdsRef.current.has(patch.id)) continue;
        if (!sendSocket({ type: "document.patch", patch, actor: patchActorsRef.current.get(patch.id) ?? "user" })) return;
        sentPatchIdsRef.current.add(patch.id);
      }
    };
    const flushDeferred = () => {
      if (!readyToSendRef.current || pendingPatchesRef.current.length > 0) return;
      for (const message of deferredMessagesRef.current.values()) {
        if (!sendSocket(message)) return;
      }
      deferredMessagesRef.current.clear();
    };
    const connect = () => {
      if (disposed) return;
      setState((current) => ({ ...current, status: attempts === 0 ? "connecting" : "reconnecting" }));
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const query = new URLSearchParams(window.location.search);
      const candidate = tokenRef.current ?? sessionStorage.getItem(`editable-pixel-token:${sessionId}`) ?? query.get("bootstrap") ?? "";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/ws?token=${encodeURIComponent(candidate)}`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        attempts = 0;
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          document?: PixelDocument;
          clients?: string[];
          host?: "browser" | "codex" | "claude";
          pendingPatch?: PendingPatch;
          persistentToken?: string;
          projectContext?: SessionProjectContext;
          project?: SessionProjectState;
          projectChanged?: boolean;
          commandId?: string;
          command?: WebCommandEnvelope["command"];
        };
        if (message.type === "session.auth" && message.persistentToken) {
          tokenRef.current = message.persistentToken;
          setToken(message.persistentToken);
          sessionStorage.setItem(`editable-pixel-token:${sessionId}`, message.persistentToken);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("bootstrap");
          window.history.replaceState(null, "", cleanUrl);
        }
        if (message.type === "conflict") {
          readyToSendRef.current = false;
          setState((current) => ({ ...current, status: "conflict" }));
          return;
        }
        if (message.document) {
          const pending = pendingPatchesRef.current;
          if (pending.length > 0) {
            const acknowledgedIndex = pending.findIndex((patch) => patch.baseRevision + 1 === message.document!.revision);
            if (acknowledgedIndex >= 0) {
              const acknowledged = pending.splice(0, acknowledgedIndex + 1);
              for (const patch of acknowledged) {
                sentPatchIdsRef.current.delete(patch.id);
                patchActorsRef.current.delete(patch.id);
              }
            } else if (message.document.revision > pending[0]!.baseRevision) {
              readyToSendRef.current = false;
              setState((current) => ({ ...current, status: "conflict" }));
              return;
            }
          }
          readyToSendRef.current = true;
          if (pendingPatchesRef.current.length === 0) {
            onDocument(message.document, message.project, message.projectChanged);
            setState((current) => ({ ...current, status: "connected", pendingDocumentPatches: 0 }));
            flushDeferred();
          } else {
            setState((current) => ({
              ...current,
              status: "reconnecting",
              pendingDocumentPatches: pendingPatchesRef.current.length
            }));
            flushPending();
          }
        }
        setState((current) => ({
          ...current,
          ...(message.clients ? { clients: message.clients } : {}),
          ...(message.host ? { host: message.host } : {}),
          ...(message.projectContext ? { projectContext: message.projectContext } : {}),
          ...(message.type === "patch.preview" ? { pendingPatch: message.pendingPatch } : {}),
          ...(message.type === "patch.resolved" ? { pendingPatch: undefined } : {}),
          ...(message.type === "web.command" && message.commandId && message.command
            ? {
              webCommands: current.webCommands.some((command) => command.id === message.commandId)
                ? current.webCommands
                : [...current.webCommands, { id: message.commandId, command: message.command }]
            }
            : {})
        }));
      });
      socket.addEventListener("close", () => {
        if (disposed || socketRef.current !== socket) return;
        readyToSendRef.current = false;
        sentPatchIdsRef.current.clear();
        attempts += 1;
        retryRef.current = window.setTimeout(connect, Math.min(5000, 500 * 2 ** attempts));
      });
    };
    const onOffline = () => {
      readyToSendRef.current = false;
      sentPatchIdsRef.current.clear();
      setState((current) => ({ ...current, status: "reconnecting" }));
      socketRef.current?.close();
    };
    const onOnline = () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
      retryRef.current = undefined;
      connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      socketRef.current?.close();
    };
  }, [onDocument, sessionId]);

  const sendOrDefer = useCallback((key: string, message: unknown) => {
    if (readyToSendRef.current && pendingPatchesRef.current.length === 0 && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      deferredMessagesRef.current.set(key, message);
    }
  }, []);

  return {
    ...state,
    ...(token ? { token } : {}),
    sendSelection: (selection) => sendOrDefer("selection", { type: "selection.set", selection }),
    sendPatch: (patch, actor = "user") => {
      if (!pendingPatchesRef.current.some((candidate) => candidate.id === patch.id)) {
        pendingPatchesRef.current.push(patch);
        setState((current) => ({ ...current, pendingDocumentPatches: pendingPatchesRef.current.length }));
      }
      patchActorsRef.current.set(patch.id, actor);
      if (readyToSendRef.current && socketRef.current?.readyState === WebSocket.OPEN && !sentPatchIdsRef.current.has(patch.id)) {
        socketRef.current.send(JSON.stringify({ type: "document.patch", patch, actor }));
        sentPatchIdsRef.current.add(patch.id);
      }
    },
    sendContext: (context) => sendOrDefer("context", { type: "context.set", context }),
    decidePatch: (patchId, decision) => sendOrDefer("patch-decision", { type: "patch.decision", patchId, decision }),
    requestUndo: () => sendOrDefer("history", { type: "history.undo" }),
    requestRedo: () => sendOrDefer("history", { type: "history.redo" }),
    completeWebCommand: (commandId, completion) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: "web.command.result",
          commandId,
          ...completion
        }));
      }
      setState((current) => ({
        ...current,
        webCommands: current.webCommands.filter((command) => command.id !== commandId)
      }));
    }
  };
}
