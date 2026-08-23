import { createPixelDocument } from "@editable-pixel/document";
import { renderPng } from "@editable-pixel/renderer/node";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { startPixelServer, type RunningPixelServer } from "./server.js";

const running: RunningPixelServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe("PixelServer", () => {
  it("requires daemon authentication and isolates sessions", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const unauthorized = await fetch(`${base}/api/sessions`);
    expect(unauthorized.status).toBe(401);

    const first = await createSession(base, server.daemonToken, 2);
    const second = await createSession(base, server.daemonToken, 3);
    const sessions = await fetch(`${base}/api/sessions`, { headers: auth(server.daemonToken) });
    const payload = await sessions.json() as { sessions: Array<{ id: string }> };

    expect(payload.sessions.map((session) => session.id)).toEqual([first.session.id, second.session.id]);
  });

  it("upgrades a one-time browser token and rejects it after consumption", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);
    const first = new WebSocket(
      `ws://${server.host}:${server.port}/api/sessions/${created.session.id}/ws?token=${created.bootstrapToken}`,
      { origin: base }
    );
    const message = await nextMessage(first);
    expect(message).toMatchObject({ type: "session.auth", persistentToken: created.persistentToken });
    first.close();

    const second = new WebSocket(
      `ws://${server.host}:${server.port}/api/sessions/${created.session.id}/ws?token=${created.bootstrapToken}`,
      { origin: base }
    );
    const closeCode = await new Promise<number>((resolve) => second.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0)));
    expect(closeCode).toBe(401);
  });

  it("rejects untrusted HTTP origins and Host headers", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;

    const badOrigin = await fetch(`${base}/api/health`, {
      headers: { ...auth(server.daemonToken), Origin: "https://attacker.example" }
    });
    expect(badOrigin.status).toBe(403);
    await expect(badOrigin.json()).resolves.toMatchObject({ error: { code: "ORIGIN_REJECTED" } });

    const badHost = await rawRequest(server.port, {
      Host: "attacker.example",
      Authorization: `Bearer ${server.daemonToken}`
    });
    expect(badHost.status).toBe(403);
    expect(badHost.body).toMatchObject({ error: { code: "HOST_REJECTED" } });
  });

  it("rejects the former session token after session close", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);

    const closed = await fetch(`${base}/api/sessions/${created.session.id}`, {
      method: "DELETE",
      headers: auth(server.daemonToken)
    });
    expect(closed.status).toBe(200);

    const afterClose = await fetch(`${base}/api/sessions/${created.session.id}`, {
      headers: auth(created.persistentToken)
    });
    expect(afterClose.status).toBe(404);
    await expect(afterClose.json()).resolves.toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });
  });

  it("returns actionable conversion errors for invalid options and formats", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);
    const png = await renderPng(createPixelDocument({ width: 1, height: 1, pixels: [1] }));

    const invalidOptions = new FormData();
    invalidOptions.append("image", new Blob([Uint8Array.from(png)], { type: "image/png" }), "asset.png");
    invalidOptions.append("options", JSON.stringify({ canvasWidth: 0, canvasHeight: 2 }));
    const optionResponse = await fetch(`${base}/api/convert?session=${created.session.id}`, {
      method: "POST",
      headers: auth(server.daemonToken),
      body: invalidOptions
    });
    expect(optionResponse.status).toBe(400);
    await expect(optionResponse.json()).resolves.toMatchObject({ error: { code: "OPTIONS_INVALID" } });

    const unsupported = new FormData();
    unsupported.append("image", new Blob([Uint8Array.from(png)], { type: "image/gif" }), "asset.gif");
    unsupported.append("options", JSON.stringify({ canvasWidth: 2, canvasHeight: 2 }));
    const formatResponse = await fetch(`${base}/api/convert?session=${created.session.id}`, {
      method: "POST",
      headers: auth(server.daemonToken),
      body: unsupported
    });
    expect(formatResponse.status).toBe(415);
    await expect(formatResponse.json()).resolves.toMatchObject({ error: { code: "IMAGE_FORMAT_UNSUPPORTED" } });
  });
});

async function createSession(base: string, token: string, width: number) {
  const response = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ document: createPixelDocument({ width, height: width }) })
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{
    session: { id: string };
    bootstrapToken: string;
    persistentToken: string;
  }>;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (value) => resolve(JSON.parse(value.toString()) as Record<string, unknown>));
    socket.once("error", reject);
  });
}

function rawRequest(port: number, headers: Record<string, string>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const call = request({ host: "127.0.0.1", port, path: "/api/health", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
      }));
    });
    call.once("error", reject);
    call.end();
  });
}
