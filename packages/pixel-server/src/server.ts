import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, relative as pathRelative, resolve } from "node:path";

import { convertBatch, type ConvertOptions, type InputMetadata } from "@editable-pixel/converter";
import type { Patch } from "@editable-pixel/core";
import { validatePixelDocument, type PixelDocument, type Selection } from "@editable-pixel/document";
import { renderPreviewPng } from "@editable-pixel/renderer/node";
import Busboy from "busboy";
import { WebSocket, WebSocketServer } from "ws";

import { SessionError, SessionStore, type SessionSnapshot } from "./session-store.js";

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 64;

export interface PixelServerOptions {
  port?: number;
  host?: "127.0.0.1";
  webDist?: string;
  daemonToken?: string;
}

export interface RunningPixelServer {
  port: number;
  host: "127.0.0.1";
  daemonToken: string;
  store: SessionStore;
  close: () => Promise<void>;
}

export async function startPixelServer(options: PixelServerOptions = {}): Promise<RunningPixelServer> {
  const host = options.host ?? "127.0.0.1";
  const daemonToken = options.daemonToken ?? randomBytes(32).toString("base64url");
  const store = new SessionStore();
  const sockets = new Map<string, Set<WebSocket>>();
  const rateLimits = new Map<string, { start: number; count: number }>();
  let port = options.port ?? 0;
  const webDist = options.webDist ? await realpath(options.webDist) : undefined;
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_JSON_BYTES });

  const httpServer = createServer(async (request, response) => {
    try {
      validateHostAndOrigin(request, port);
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      applyRateLimit(rateLimits, bearer(request) || request.socket.remoteAddress || "anonymous");

      if (request.method === "GET" && url.pathname === "/api/health") {
        requireDaemon(request, daemonToken);
        return json(response, 200, { ok: true, pid: process.pid, port });
      }
      if (request.method === "GET" && url.pathname === "/api/sessions") {
        requireDaemon(request, daemonToken);
        return json(response, 200, { sessions: store.list() });
      }
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        requireDaemon(request, daemonToken);
        const body = await jsonBody<{
          document?: PixelDocument;
          documentPath?: string;
          outputDirectory?: string;
          host?: "browser" | "codex" | "claude";
        }>(request);
        const created = await store.create(body);
        return json(response, 201, created);
      }
      if (request.method === "POST" && url.pathname === "/api/convert") {
        const sessionId = url.searchParams.get("session");
        if (!sessionId) throw new SessionError("SESSION_REQUIRED", "A session is required for browser conversion.", 401);
        const clientName = authorizeSession(request, store, sessionId, daemonToken);
        if (clientName) {
          const session = store.touchClient(sessionId, clientName);
          broadcast(sockets, sessionId, { type: "clients", clients: session.clients });
        }
        const converted = await parseConversion(request);
        return json(response, 200, converted.length === 1 ? converted[0] : { results: converted });
      }
      if (request.method === "POST" && url.pathname === "/api/validate") {
        requireDaemon(request, daemonToken);
        const body = await jsonBody<{ document: unknown }>(request);
        return json(response, 200, validatePixelDocument(body.document));
      }

      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const sessionId = decodeURIComponent(match[1]!);
        const action = match[2] ?? "";
        const clientName = authorizeSession(request, store, sessionId, daemonToken);
        if (clientName) {
          const session = store.touchClient(sessionId, clientName);
          broadcast(sockets, sessionId, { type: "clients", clients: session.clients });
        }
        if (request.method === "GET" && action === "") return json(response, 200, store.get(sessionId));
        if (request.method === "DELETE" && action === "") {
          store.close(sessionId);
          for (const socket of sockets.get(sessionId) ?? []) socket.close(1000, "Session closed");
          sockets.delete(sessionId);
          return json(response, 200, { closed: true, sessionId });
        }
        if (request.method === "GET" && action === "selection") {
          return json(response, 200, { sessionId, selection: store.get(sessionId).selection ?? null });
        }
        if (request.method === "POST" && action === "selection") {
          const body = await jsonBody<{ selection?: Selection }>(request);
          const session = store.setSelection(sessionId, body.selection);
          broadcast(sockets, sessionId, { type: "state", ...sessionMessage(session) });
          return json(response, 200, session);
        }
        if (request.method === "POST" && action === "patches/preview") {
          const body = await jsonBody<{ patch: Patch }>(request);
          const pendingPatch = store.previewPatch(sessionId, body.patch);
          broadcast(sockets, sessionId, { type: "patch.preview", pendingPatch });
          return json(response, 200, pendingPatch);
        }
        if (request.method === "POST" && action === "patches/create") {
          const body = await jsonBody<{
            layerId?: string;
            frameId?: string;
            reason: string;
            requireSelection?: boolean;
            newColors?: string[];
            changes: Array<{ x: number; y: number; colorIndex: number }>;
          }>(request);
          const patch = store.createPatch(sessionId, body);
          return json(response, 200, { patch });
        }
        if (request.method === "POST" && action === "patches/apply") {
          const body = await jsonBody<{ patch?: Patch; patchId?: string }>(request);
          if (!body.patch && !body.patchId) throw new SessionError("PATCH_REQUIRED", "Provide patch or patchId.", 400);
          const session = await store.applyPatch(sessionId, body.patch ?? body.patchId!);
          broadcast(sockets, sessionId, { type: "patch.resolved", ...sessionMessage(session) });
          return json(response, 200, session);
        }
        if (request.method === "POST" && action === "patches/reject") {
          const body = await jsonBody<{ patchId: string }>(request);
          const session = store.rejectPatch(sessionId, body.patchId);
          broadcast(sockets, sessionId, { type: "patch.resolved", ...sessionMessage(session) });
          return json(response, 200, session);
        }
        if (request.method === "POST" && (action === "undo" || action === "redo")) {
          const session = action === "undo" ? await store.undo(sessionId) : await store.redo(sessionId);
          broadcast(sockets, sessionId, { type: "state", ...sessionMessage(session) });
          return json(response, 200, session);
        }
        if (request.method === "POST" && action === "render-preview") {
          const body = await jsonBody<{ scale?: number; frameId?: string }>(request);
          const session = store.get(sessionId);
          const scale = body.scale ?? 8;
          const png = await renderPreviewPng(session.document, scale, { frameId: body.frameId });
          return json(response, 200, {
            mimeType: "image/png",
            data: png.toString("base64"),
            width: session.document.canvas.width * scale,
            height: session.document.canvas.height * scale
          });
        }
      }

      if (request.method === "GET" && webDist) return serveStatic(response, webDist, url.pathname);
      throw new SessionError("NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      respondError(response, error);
    }
  });

  httpServer.on("upgrade", (request, socket, head) => {
    try {
      validateHostAndOrigin(request, port);
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/ws$/);
      if (!match) throw new SessionError("NOT_FOUND", "WebSocket route not found.", 404);
      const sessionId = decodeURIComponent(match[1]!);
      const candidate = url.searchParams.get("token") ?? "";
      const auth = store.authenticate(sessionId, candidate, true);
      wsServer.handleUpgrade(request, socket, head, (webSocket) => {
        const clientId = `web-${randomBytes(6).toString("hex")}`;
        const sessionSockets = sockets.get(sessionId) ?? new Set<WebSocket>();
        sessionSockets.add(webSocket);
        sockets.set(sessionId, sessionSockets);
        const session = store.addClient(sessionId, clientId);
        webSocket.send(JSON.stringify({ type: "session.auth", persistentToken: auth.persistentToken }));
        webSocket.send(JSON.stringify({ type: "state", ...sessionMessage(session) }));
        broadcast(sockets, sessionId, { type: "clients", clients: session.clients });
        let messageQueue = Promise.resolve();
        webSocket.on("message", (raw) => {
          messageQueue = messageQueue.then(async () => {
            try {
            const message = JSON.parse(raw.toString()) as {
              type: string;
              selection?: Selection;
              patch?: Patch;
              patchId?: string;
              decision?: "apply" | "reject";
            };
            if (message.type === "selection.set") {
              const updated = store.setSelection(sessionId, message.selection);
              broadcast(sockets, sessionId, { type: "state", ...sessionMessage(updated) });
            } else if (message.type === "document.patch" && message.patch) {
              const updated = await store.applyPatch(sessionId, message.patch);
              broadcast(sockets, sessionId, { type: "state", ...sessionMessage(updated) });
            } else if (message.type === "patch.decision" && message.patchId) {
              const updated = message.decision === "apply"
                ? await store.applyPatch(sessionId, message.patchId)
                : store.rejectPatch(sessionId, message.patchId);
              broadcast(sockets, sessionId, { type: "patch.resolved", ...sessionMessage(updated) });
            } else if (message.type === "history.undo") {
              const updated = await store.undo(sessionId);
              broadcast(sockets, sessionId, { type: "state", ...sessionMessage(updated) });
            } else if (message.type === "history.redo") {
              const updated = await store.redo(sessionId);
              broadcast(sockets, sessionId, { type: "state", ...sessionMessage(updated) });
            }
            } catch (error) {
              webSocket.send(JSON.stringify({
                type: error instanceof SessionError && error.status === 409 ? "conflict" : "error",
                error: errorPayload(error)
              }));
            }
          });
        });
        webSocket.on("close", () => {
          sessionSockets.delete(webSocket);
          store.removeClient(sessionId, clientId);
          if (sessionSockets.size === 0) sockets.delete(sessionId);
        });
      });
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => resolvePromise());
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind to a TCP port.");
  port = address.port;

  return {
    port,
    host,
    daemonToken,
    store,
    close: () => new Promise<void>((resolvePromise, reject) => {
      for (const sessionSockets of sockets.values()) for (const socket of sessionSockets) socket.close();
      wsServer.close();
      httpServer.close((error) => error ? reject(error) : resolvePromise());
    })
  };
}

async function parseConversion(request: IncomingMessage) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new SessionError("MULTIPART_REQUIRED", "Conversion requires multipart/form-data.", 415);
  }
  const images: Array<{ chunks: Buffer[]; size: number; metadata: InputMetadata }> = [];
  let optionsText = "{}";
  await new Promise<void>((resolvePromise, reject) => {
    const parser = Busboy({ headers: request.headers, limits: { files: MAX_IMAGES, fileSize: MAX_IMAGE_BYTES, fields: 4 } });
    parser.on("file", (_name, stream, info) => {
      if (!new Set(["image/png", "image/webp", "image/jpeg"]).has(info.mimeType)) {
        stream.resume();
        reject(new SessionError(
          "IMAGE_FORMAT_UNSUPPORTED",
          `Unsupported image type ${info.mimeType || "unknown"}. Use PNG, WebP, or JPEG.`,
          415
        ));
        return;
      }
      const image = { chunks: [] as Buffer[], size: 0, metadata: { name: info.filename, mimeType: info.mimeType } };
      images.push(image);
      stream.on("data", (chunk: Buffer) => { image.size += chunk.length; image.chunks.push(chunk); });
      stream.on("limit", () => reject(new SessionError("IMAGE_TOO_LARGE", "Each image must be 20MB or smaller.", 413)));
    });
    parser.on("filesLimit", () => reject(new SessionError(
      "IMAGE_LIMIT_EXCEEDED",
      `A batch may contain at most ${MAX_IMAGES} images.`,
      413
    )));
    parser.on("field", (name, value) => { if (name === "options") optionsText = value; });
    parser.on("error", reject);
    parser.on("finish", resolvePromise);
    request.pipe(parser);
  });
  if (images.length === 0) throw new SessionError("IMAGE_REQUIRED", "Upload at least one image.", 400);
  let options: ConvertOptions;
  try {
    options = JSON.parse(optionsText) as ConvertOptions;
  } catch {
    throw new SessionError("OPTIONS_INVALID", "Conversion options must be valid JSON.", 400);
  }
  try {
    return await convertBatch(
      images.map((image) => ({ input: Buffer.concat(image.chunks), metadata: image.metadata })),
      options
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image could not be converted.";
    if (message.includes("background remover")) {
      throw new SessionError("BACKGROUND_REMOVAL_UNAVAILABLE", message, 422);
    }
    if (/canvas|dimension|color|palette|scale|alignment|content box|background tolerance|alpha threshold|rgba/i.test(message)) {
      throw new SessionError("OPTIONS_INVALID", message, 400);
    }
    throw new SessionError(
      "IMAGE_CONVERSION_FAILED",
      "The image could not be decoded or converted. Use a valid PNG, WebP, or JPEG file.",
      422
    );
  }
}

async function serveStatic(response: ServerResponse, root: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const normalized = normalize(relative);
  if (normalized.startsWith("..") || normalized.includes("\0")) {
    throw new SessionError("PATH_TRAVERSAL", "Invalid static asset path.", 403);
  }
  let file = resolve(root, normalized);
  const fromRoot = pathRelative(root, file);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new SessionError("PATH_TRAVERSAL", "Invalid static asset path.", 403);
  }
  try {
    await access(file);
  } catch {
    file = join(root, "index.html");
  }
  const info = await stat(file);
  if (!info.isFile()) throw new SessionError("NOT_FOUND", "Static asset not found.", 404);
  response.writeHead(200, {
    "Content-Type": mime(extname(file)),
    "Content-Length": info.size,
    "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'"
  });
  createReadStream(file).pipe(response);
}

function validateHostAndOrigin(request: IncomingMessage, port: number): void {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (port !== 0 && !allowedHosts.has(request.headers.host ?? "")) {
    throw new SessionError("HOST_REJECTED", "Request host is not allowed.", 403);
  }
  const origin = request.headers.origin;
  if (origin) {
    const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));
    if (!allowedOrigins.has(origin)) throw new SessionError("ORIGIN_REJECTED", "Request origin is not allowed.", 403);
  }
}

function authorizeSession(
  request: IncomingMessage,
  store: SessionStore,
  id: string,
  daemonToken: string
): string | undefined {
  const candidate = bearer(request);
  if (candidate !== daemonToken) store.authenticate(id, candidate);
  const value = request.headers["x-editable-pixel-client"];
  const clientName = Array.isArray(value) ? value[0] : value;
  if (!clientName) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(clientName)) {
    throw new SessionError("CLIENT_NAME_INVALID", "Client name is invalid.", 400);
  }
  return clientName.toLowerCase();
}

function requireDaemon(request: IncomingMessage, daemonToken: string): void {
  if (bearer(request) !== daemonToken) throw new SessionError("AUTH_INVALID", "Daemon token is invalid.", 401);
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function jsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new SessionError("REQUEST_TOO_LARGE", "JSON request exceeds 5MB.", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
  } catch {
    throw new SessionError("JSON_INVALID", "Request body must be valid JSON.", 400);
  }
}

function applyRateLimit(limits: Map<string, { start: number; count: number }>, key: string): void {
  const now = Date.now();
  const current = limits.get(key);
  if (!current || now - current.start >= 60_000) {
    limits.set(key, { start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 240) throw new SessionError("RATE_LIMITED", "Too many requests; retry in one minute.", 429);
}

function broadcast(sockets: Map<string, Set<WebSocket>>, id: string, message: unknown): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets.get(id) ?? []) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function sessionMessage(session: SessionSnapshot) {
  return { document: session.document, clients: session.clients, host: session.host };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

function respondError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const payload = errorPayload(error);
  json(response, error instanceof SessionError ? error.status : 500, payload);
}

function errorPayload(error: unknown): { error: { code: string; message: string } } {
  if (error instanceof SessionError) return { error: { code: error.code, message: error.message } };
  return { error: { code: "INTERNAL_ERROR", message: "The local server could not complete the request." } };
}

function mime(extension: string): string {
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "text/html; charset=utf-8";
}
