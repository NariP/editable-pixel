import type { Patch } from "@editable-pixel/core";
import type { PixelDocument } from "@editable-pixel/document";
import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "standalone" | "connecting" | "connected" | "reconnecting" | "conflict";

export interface PendingPatch {
  patch: Patch;
  before: PixelDocument;
  after: PixelDocument;
}

interface SessionState {
  status: ConnectionStatus;
  clients: string[];
  host?: "browser" | "codex" | "claude";
  pendingPatch?: PendingPatch;
}

export function usePixelSession(
  sessionId: string | undefined,
  onDocument: (document: PixelDocument) => void
): SessionState & {
  token?: string;
  sendSelection: (selection: PixelDocument["selection"]) => void;
  sendPatch: (patch: Patch) => void;
  decidePatch: (patchId: string, decision: "apply" | "reject") => void;
  requestUndo: () => void;
  requestRedo: () => void;
} {
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const retryRef = useRef<number | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState<string>();
  const [state, setState] = useState<SessionState>({
    status: sessionId ? "connecting" : "standalone",
    clients: []
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ status: "standalone", clients: [] });
      return;
    }
    let disposed = false;
    let attempts = 0;
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
        setState((current) => ({ ...current, status: "connected" }));
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          document?: PixelDocument;
          clients?: string[];
          host?: "browser" | "codex" | "claude";
          pendingPatch?: PendingPatch;
          persistentToken?: string;
        };
        if (message.type === "session.auth" && message.persistentToken) {
          tokenRef.current = message.persistentToken;
          setToken(message.persistentToken);
          sessionStorage.setItem(`editable-pixel-token:${sessionId}`, message.persistentToken);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("bootstrap");
          window.history.replaceState(null, "", cleanUrl);
        }
        if (message.document) onDocument(message.document);
        if (message.type === "conflict") setState((current) => ({ ...current, status: "conflict" }));
        else setState((current) => ({
          ...current,
          ...(message.clients ? { clients: message.clients } : {}),
          ...(message.host ? { host: message.host } : {}),
          ...(message.type === "patch.preview" ? { pendingPatch: message.pendingPatch } : {}),
          ...(message.type === "patch.resolved" ? { pendingPatch: undefined } : {})
        }));
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        attempts += 1;
        retryRef.current = window.setTimeout(connect, Math.min(5000, 500 * 2 ** attempts));
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, [onDocument, sessionId]);

  const send = useCallback((message: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  return {
    ...state,
    ...(token ? { token } : {}),
    sendSelection: (selection) => send({ type: "selection.set", selection }),
    sendPatch: (patch) => send({ type: "document.patch", patch }),
    decidePatch: (patchId, decision) => send({ type: "patch.decision", patchId, decision }),
    requestUndo: () => send({ type: "history.undo" }),
    requestRedo: () => send({ type: "history.redo" })
  };
}
