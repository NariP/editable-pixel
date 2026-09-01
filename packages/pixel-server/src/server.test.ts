import { createPixelDocument } from "@editable-pixel/document";
import { commitPixelProject, createPixelProject } from "@editable-pixel/project";
import { renderPng } from "@editable-pixel/renderer/node";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";

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

  it("persists project revisions through an authenticated local session", async () => {
    const root = await mkdtemp(join(tmpdir(), "editable-pixel-server-projects-"));
    const server = await startPixelServer({ projectStoreRoot: root });
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);
    const project = createPixelProject({ name: "Robot" });

    const first = await fetch(`${base}/api/sessions/${created.session.id}/project`, {
      method: "PUT",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ project, expectedRevision: -1 })
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ projectId: project.id, revision: 0 });
    const context = await fetch(`${base}/api/sessions/${created.session.id}/project-context`, {
      headers: auth(created.persistentToken)
    });
    await expect(context.json()).resolves.toMatchObject({
      context: { projectId: project.id, projectName: "Robot" }
    });

    await fetch(`${base}/api/sessions/${created.session.id}/selection`, {
      method: "POST",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ selection: { type: "rect", x: 0, y: 0, width: 1, height: 1, layerId: "artwork", frameId: "frame-1" } })
    });
    const pixelContext = await fetch(`${base}/api/sessions/${created.session.id}/selection-context?padding=0`, {
      headers: auth(created.persistentToken)
    });
    await expect(pixelContext.json()).resolves.toMatchObject({ colorIndices: [[0]], revision: 1 });

    const updated = commitPixelProject(project, (draft) => { draft.name = "Robot Walk"; });
    const second = await fetch(`${base}/api/sessions/${created.session.id}/project`, {
      method: "PUT",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ project: updated, expectedRevision: 0 })
    });
    expect(second.status).toBe(200);

    const opened = await fetch(`${base}/api/sessions/${created.session.id}/projects/${project.id}`, {
      headers: auth(created.persistentToken)
    });
    await expect(opened.json()).resolves.toMatchObject({ project: { name: "Robot Walk", revision: 1 } });
    await rm(root, { recursive: true, force: true });
  });

  it("exports color, normal, and lit frames only inside the session output directory", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "editable-pixel-export-"));
    const canonicalOutputDirectory = await realpath(outputDirectory);
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { ...auth(server.daemonToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        document: createPixelDocument({ width: 2, height: 3, pixels: [1, 0, 0, 1, 1, 0] }),
        outputDirectory
      })
    }).then((response) => response.json()) as Awaited<ReturnType<typeof createSession>>;

    for (const format of ["color", "normal", "lit"] as const) {
      const exported = await fetch(`${base}/api/sessions/${created.session.id}/export-frame`, {
        method: "POST",
        headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
        body: JSON.stringify({ format, filename: `${format}.png`, scale: 2 })
      });
      expect(exported.status).toBe(201);
      await expect(exported.json()).resolves.toMatchObject({
        path: join(canonicalOutputDirectory, `${format}.png`),
        format,
        width: 4,
        height: 6
      });
      await expect(access(join(outputDirectory, `${format}.png`))).resolves.toBeUndefined();
    }

    const duplicate = await fetch(`${base}/api/sessions/${created.session.id}/export-frame`, {
      method: "POST",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "color.png" })
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: "OUTPUT_EXISTS" } });
    await rm(outputDirectory, { recursive: true, force: true });
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

  it("round-trips semantic web commands through the connected browser", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);
    const browser = new WebSocket(
      `ws://${server.host}:${server.port}/api/sessions/${created.session.id}/ws?token=${created.bootstrapToken}`,
      { origin: base }
    );
    await new Promise<void>((resolve, reject) => {
      browser.once("open", () => resolve());
      browser.once("error", reject);
    });

    const responsePromise = fetch(`${base}/api/sessions/${created.session.id}/web-command`, {
      method: "POST",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ command: { type: "set_view", showGrid: false } })
    });
    const command = await nextMessageOfType(browser, "web.command");
    expect(command).toMatchObject({ command: { type: "set_view", showGrid: false } });
    browser.send(JSON.stringify({
      type: "web.command.result",
      commandId: command.commandId,
      ok: true,
      result: { applied: "set_view" }
    }));

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ result: { applied: "set_view" } });
    browser.close();
  });

  it("requires an open browser for browser-only commands", async () => {
    const server = await startPixelServer();
    running.push(server);
    const base = `http://${server.host}:${server.port}`;
    const created = await createSession(base, server.daemonToken, 2);
    const response = await fetch(`${base}/api/sessions/${created.session.id}/web-command`, {
      method: "POST",
      headers: { ...auth(created.persistentToken), "Content-Type": "application/json" },
      body: JSON.stringify({ command: { type: "get_context" } })
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "WEB_CLIENT_REQUIRED" } });
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

function nextMessageOfType(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (value: RawData) => {
      const message = JSON.parse(value.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
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
