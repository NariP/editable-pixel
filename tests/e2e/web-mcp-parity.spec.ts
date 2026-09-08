import { createPixelDocument, NEUTRAL_NORMAL, type PixelDocument, type Selection } from "@editable-pixel/document";
import { encodePng } from "@editable-pixel/image-codec";
import { createEditablePixelMcpServer } from "@editable-pixel/mcp";
import { PixelServerClient } from "@editable-pixel/server/client";
import { Client, InMemoryTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test("web and MCP Color selection/move share Undo/Redo semantics and preserve normal data", async ({ page, context, baseURL }) => {
  await withParitySessions(page, context, baseURL, async ({ api, client, webId, mcpId, mcpPage, fixture }) => {
    const initial = await Promise.all([api.getSession(webId), api.getSession(mcpId)]);
    for (const session of initial) expect(documentContent(session.document)).toEqual(documentContent(fixture));
    const selected: Selection = { type: "rect", x: 1, y: 1, width: 2, height: 2, layerId: "artwork", frameId: "frame-1" };
    const moved = { ...selected, x: 2 };
    const selectedDocument = { ...structuredClone(fixture), selection: selected };
    const movedDocument = structuredClone(selectedDocument);
    movedDocument.selection = moved;
    // Hand-derived overlapping move: clear the source, then copy its original 2×2 cells right.
    movedDocument.layers[0]!.frames["frame-1"] = [
      1, 0, 0, 0, 0, 2,
      0, 0, 1, 2, 0, 0,
      0, 0, 2, 0, 0, 0,
      2, 0, 0, 0, 0, 1
    ];
    const beforeImage = await canvasImage(page);
    expect(await canvasImage(mcpPage)).toBe(beforeImage);

    await page.getByRole("button", { name: "Select", exact: true }).click();
    const box = await page.getByLabel("Pixel canvas").boundingBox();
    if (!box) throw new Error("Pixel canvas is not visible.");
    await page.mouse.move(box.x + box.width * 1.5 / 6, box.y + box.height * 1.5 / 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 2.5 / 6, box.y + box.height * 2.5 / 4);
    await page.mouse.up();
    await callTool(client, "set_selection", mcpId, {
      command: { type: "rect", x: 1, y: 1, width: 2, height: 2, layer_id: "artwork", frame_id: "frame-1", mode: "replace" }
    });
    await assertDocuments(selectedDocument, 1);
    for (const browser of [page, mcpPage]) {
      await expect(browser.getByText("Editing within selection · 1,1 / 2×2 · Esc to clear")).toBeVisible();
      await expect(browser.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    }

    await page.getByRole("button", { name: "Move selection right" }).click();
    await callTool(client, "use_editable_pixel", mcpId, {
      reason: "Move selection",
      action: { type: "move_selection", dx: 1, dy: 0 }
    });
    await assertDocuments(movedDocument, 2);
    await assertHistories(["applied", "applied"], true, false);
    for (const browser of [page, mcpPage]) {
      await expect(browser.getByText("Editing within selection · 2,1 / 2×2 · Esc to clear")).toBeVisible();
      await expect.poll(() => canvasImage(browser)).not.toBe(beforeImage);
    }
    const movedImage = await canvasImage(page);
    await expect.poll(() => canvasImage(mcpPage)).toBe(movedImage);

    await page.getByRole("button", { name: "Undo" }).click();
    await callTool(client, "undo", mcpId);
    await assertDocuments(selectedDocument, 3);
    await assertHistories(["undone", "applied"], true, true);
    for (const browser of [page, mcpPage]) await expect.poll(() => canvasImage(browser)).toBe(beforeImage);

    await page.getByRole("button", { name: "Undo" }).click();
    await callTool(client, "undo", mcpId);
    await assertDocuments(fixture, 4);
    await assertHistories(["undone", "undone"], false, true);
    for (const browser of [page, mcpPage]) await expect(browser.getByText("No selection")).toBeVisible();

    await page.getByRole("button", { name: "Redo" }).click();
    await callTool(client, "redo", mcpId);
    await assertDocuments(selectedDocument, 5);
    await assertHistories(["undone", "applied"], true, true);

    await page.getByRole("button", { name: "Redo" }).click();
    await callTool(client, "redo", mcpId);
    await assertDocuments(movedDocument, 6);
    await assertHistories(["applied", "applied"], true, false);
    for (const browser of [page, mcpPage]) {
      await expect(browser.getByText("Editing within selection · 2,1 / 2×2 · Esc to clear")).toBeVisible();
      await expect.poll(() => canvasImage(browser)).toBe(movedImage);
      await expect(browser.locator(".status-conflict")).toHaveCount(0);
    }

    async function assertDocuments(expected: PixelDocument, revisionDelta: number) {
      for (const [index, id] of [webId, mcpId].entries()) {
        await expect.poll(async () => {
          const session = await api.getSession(id);
          return { content: documentContent(session.document), revision: session.revision, selection: session.selection ?? null };
        }).toEqual({
          content: documentContent(expected),
          revision: initial[index]!.revision + revisionDelta,
          selection: expected.selection ?? null
        });
      }
    }

    async function assertHistories(states: string[], canUndo: boolean, canRedo: boolean) {
      for (const [index, id] of [webId, mcpId].entries()) {
        const history = await api.getHistory(id);
        expect(history).toMatchObject({ canUndo, canRedo });
        expect(history.entries.map((entry) => ({
          reason: entry.reason,
          actor: entry.actor,
          state: entry.state,
          before: entry.revisionBefore - initial[index]!.revision,
          after: entry.revisionAfter - initial[index]!.revision,
          selection: entry.selection
        }))).toEqual([
          { reason: "Move selection", actor: index === 0 ? "user" : "ai", state: states[0], before: 1, after: 2, selection: moved },
          { reason: "Set selection", actor: index === 0 ? "user" : "ai", state: states[1], before: 0, after: 1, selection: selected }
        ]);
        for (const entry of history.entries) {
          expect(entry.client).toMatch(index === 0 ? /^web-/ : /^mcp$/);
        }
      }
    }
  });
});

test("web and MCP isometric grid controls agree without changing document or history", async ({ page, context, baseURL }) => {
  await withParitySessions(page, context, baseURL, async ({ api, client, webId, mcpId, mcpPage }) => {
    const initial = await Promise.all([api.getSession(webId), api.getSession(mcpId)]);
    const initialHistory = await Promise.all([api.getHistory(webId), api.getHistory(mcpId)]);
    const initialViews = await Promise.all([webId, mcpId].map(async (id) => (
      await callTool<{ view: Record<string, unknown> }>(client, "get_web_context", id)
    ).view));
    for (const view of initialViews) expect(view).toMatchObject({ showGrid: true, gridMode: "square" });

    await page.getByRole("button", { name: "2:1 isometric grid" }).click();
    await callTool(client, "control_web", mcpId, { action: { type: "set_view", show_grid: true, grid_mode: "isometric" } });
    for (const [index, browser] of [page, mcpPage].entries()) {
      await expect(browser.getByLabel("2 to 1 isometric guide")).toBeVisible();
      await expect(browser.locator(".pixel-grid-square")).toHaveCount(0);
      await expect(browser.getByRole("button", { name: "2:1 isometric grid" })).toHaveAttribute("aria-pressed", "true");
      const id = [webId, mcpId][index]!;
      const context = await callTool<{ view: Record<string, unknown> }>(client, "get_web_context", id);
      expect(context.view).toEqual({ ...initialViews[index], showGrid: true, gridMode: "isometric" });
      const session = await api.getSession(id);
      expect(session.document).toEqual(initial[index]!.document);
      expect(session.revision).toBe(initial[index]!.revision);
      expect(await api.getHistory(id)).toEqual(initialHistory[index]);
    }
  });
});

test("partial MCP batch updates the browser and Undo/Redo restores the entire successful subset", async ({ page, context, baseURL }) => {
  await withParitySessions(page, context, baseURL, async ({ api, client, mcpId, mcpPage }) => {
    await callTool(client, "set_selection", mcpId, { command: { type: "rect", x: 1, y: 1, width: 2, height: 2, mode: "replace" } });
    const before = await api.getSession(mcpId);
    const beforeImage = await canvasImage(mcpPage);
    const previousHistory = (await api.getHistory(mcpId)).entries.length;
    const result = await callTool<{ results: Array<{ status: string; items?: Array<{ id: string; code?: string }> }> }>(client, "use_editable_pixel", mcpId, {
      base_revision: before.revision, reason: "Recolor and timing together", operations: [
        { id: "colors", action: { type: "remap_colors", selection_only: true, mappings: [
          { id: "accent", from_color_index: 1, to_color: "#abcdefFF" }, { id: "invalid-shade", from_color_index: 99, to_color: "#001122ff" }
        ] } },
        { id: "bad-action", action: { type: "not-an-action" } },
        { id: "timing", action: { type: "set_frame_duration", frame_id: "frame-1", duration_ms: 120 } }
      ]
    });
    expect(result.results.map((item) => item.status)).toEqual(["partial", "failed", "applied"]);
    expect(result.results[0]!.items).toContainEqual(expect.objectContaining({ id: "invalid-shade", code: "INVALID_SOURCE" }));
    const after = await api.getSession(mcpId);
    const expectedPixels = [...before.document.layers[0]!.frames["frame-1"]!];
    expectedPixels[7] = before.document.palette.length;
    expect(after.document.layers[0]!.frames["frame-1"]).toEqual(expectedPixels);
    expect(after.document.layers[0]!.frames["frame-2"]).toEqual(before.document.layers[0]!.frames["frame-2"]);
    expect(after.document.layers[0]!.normalFrames).toEqual(before.document.layers[0]!.normalFrames);
    expect(after.document.layers[1]).toEqual(before.document.layers[1]);
    expect(after.document.frames[0]!.durationMs).toBe(120);
    expect((await api.getHistory(mcpId)).entries).toHaveLength(previousHistory + 1);
    await expect.poll(() => canvasImage(mcpPage)).not.toBe(beforeImage);
    await mcpPage.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await api.getSession(mcpId)).document.layers).toEqual(before.document.layers);
    expect((await api.getSession(mcpId)).document.frames).toEqual(before.document.frames);
    await expect.poll(() => canvasImage(mcpPage)).toBe(beforeImage);
    await mcpPage.getByRole("button", { name: "Redo" }).click();
    await expect.poll(async () => (await api.getSession(mcpId)).document.layers).toEqual(after.document.layers);
    expect((await api.getSession(mcpId)).document.frames).toEqual(after.document.frames);
  });
});

function parityDocument(): PixelDocument {
  const document = createPixelDocument({
    id: "color-move-parity",
    width: 6,
    height: 4,
    palette: ["#00000000", "#ff7a00ff", "#00dff7ff"],
    pixels: [
      1, 0, 0, 0, 0, 2,
      0, 1, 2, 1, 0, 0,
      0, 2, 0, 2, 0, 0,
      2, 0, 0, 0, 0, 1
    ]
  });
  document.frames[0]!.durationMs = 80;
  document.frames.push({ id: "frame-2", name: "Frame 2", durationMs: 170 });
  document.layers[0]!.frames["frame-2"] = Array.from({ length: 24 }, (_, index) => index % 3);
  document.layers[0]!.normalFrames = {
    "frame-1": Array.from({ length: 24 }, (_, index) => [NEUTRAL_NORMAL, 0xff8080, 0x80ff80][index % 3]!),
    "frame-2": new Array<number>(24).fill(0x008080)
  };
  document.layers.push({
    ...structuredClone(document.layers[0]!),
    id: "untouched-layer",
    name: "Untouched layer",
    visible: false
  });
  return document;
}

test("UI and MCP reopen independent projects without reload or save conflicts", async ({ page, context, baseURL }) => {
  await withParitySessions(page, context, baseURL, async ({ api, client, webId, mcpId, mcpPage, fixture, sessionHeaders }) => {
    for (const [browser, sessionId, useMcp] of [[page, webId, false], [mcpPage, mcpId, true]] as const) {
      await expect.poll(async () => (await api.getSession(sessionId)).project?.id).toBeTruthy();
      await browser.getByRole("button", { name: "Project menu" }).click();
      await browser.getByRole("textbox", { name: "Project name", exact: true }).fill(`Original ${useMcp ? "MCP" : "UI"}`);
      await browser.getByRole("textbox", { name: "Project name", exact: true }).press("Enter");
      await browser.keyboard.press("Escape");
      await expect.poll(async () => (await api.getSession(sessionId)).project?.name).toBe(`Original ${useMcp ? "MCP" : "UI"}`);
      const beforeSourceRevision = (await api.getSession(sessionId)).project!.revision;
      const source = Buffer.from(await encodePng({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }));
      await browser.locator('input[type="file"]').setInputFiles({ name: "original-source.png", mimeType: "image/png", buffer: source });
      await browser.getByRole("button", { name: /Add Source/ }).click();
      await expect(browser.getByLabel("1 source")).toBeVisible();
      await expect.poll(async () => (await api.getSession(sessionId)).project?.revision).toBeGreaterThan(beforeSourceRevision);
      const original = (await api.getSession(sessionId)).project!;
      const savedResponse = await browser.request.get(`/api/sessions/${sessionId}/projects/${original.id}`, {
        headers: sessionHeaders(sessionId)
      });
      expect(savedResponse.ok()).toBe(true);
      const saved = (await savedResponse.json()).project;
      await browser.getByRole("button", { name: "Project menu" }).click();
      await browser.getByLabel("Open Project file input").setInputFiles({
        name: "original.pixel-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved))
      });
      await expect(browser.getByRole("navigation", { name: "Project location" })).toContainText(original.name);
      await expect.poll(async () => (await api.getSession(sessionId)).project?.revision).toBeGreaterThan(original.revision);
      const reopened = await api.getSession(sessionId);
      const readStored = async () => (await (await browser.request.get(`/api/sessions/${sessionId}/projects/${original.id}`, {
        headers: sessionHeaders(sessionId)
      })).json()).project;
      await expect.poll(async () => {
        const stored = await readStored();
        return { revision: stored.revision, document: stored.document };
      }).toEqual({ revision: reopened.project!.revision, document: reopened.document });
      const beforeRejectedFile = await api.getSession(sessionId);
      const storedBeforeRejectedFile = await readStored();
      await browser.getByRole("button", { name: "Project menu" }).click();
      await browser.getByLabel("Open Project file input").setInputFiles({
        name: "stale.pixel-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved))
      });
      await expect(browser.getByRole("alert")).toContainText("differs from the saved revision");
      expect((await api.getSession(sessionId)).project).toEqual(beforeRejectedFile.project);
      expect((await api.getSession(sessionId)).document).toEqual(beforeRejectedFile.document);
      expect(await readStored()).toEqual(storedBeforeRejectedFile);
      await browser.keyboard.press("Escape");
      await expect(browser.locator(".source-name b").filter({ hasText: "original-source.png" })).toBeVisible();
      if (useMcp) {
        await callTool(client, "control_web", sessionId, { action: { type: "new_project", name: "Second project" } });
      } else {
        await browser.getByRole("button", { name: "Project menu" }).click();
        await browser.getByRole("button", { name: "New", exact: true }).click();
      }
      await expect.poll(async () => (await api.getSession(sessionId)).project?.id).not.toBe(original.id);
      if (!useMcp) {
        await browser.getByRole("button", { name: "Project menu" }).click();
        await browser.getByRole("textbox", { name: "Project name", exact: true }).fill("Second UI project");
        await browser.getByRole("textbox", { name: "Project name", exact: true }).press("Enter");
        await browser.keyboard.press("Escape");
        await expect.poll(async () => (await api.getSession(sessionId)).project?.name).toBe("Second UI project");
      }
      await expect(browser.locator(".source-name b").filter({ hasText: "original-source.png" })).toHaveCount(0);
      const second = (await api.getSession(sessionId)).project!;
      await callTool(client, "set_selection", sessionId, {
        command: { type: "rect", x: 0, y: 0, width: 1, height: 1, mode: "replace" }
      });
      await callTool(client, "use_editable_pixel", sessionId, {
        reason: "Edit second project only", action: { type: "paint_selection", color_index: 1 }
      });
      await expect.poll(async () => (await api.getSession(sessionId)).document.layers[0]!.frames["frame-1"]![0]).toBe(1);
      const reopen = async (id: string, name: string) => {
        if (useMcp) await callTool(client, "control_web", sessionId, { action: { type: "open_recent_project", project_id: id } });
        else {
          await browser.getByRole("button", { name: "Project menu" }).click();
          await browser.locator(".recent-project-row > button:first-child").filter({ hasText: name }).click();
        }
        await expect.poll(async () => (await api.getSession(sessionId)).project?.id).toBe(id);
      };
      await reopen(original.id, original.name);
      const originalRestored = (await api.getSession(sessionId)).document;
      expect(originalRestored.layers).toEqual(fixture.layers);
      expect(originalRestored.palette).toEqual(fixture.palette);
      expect(originalRestored.canvas).toEqual(fixture.canvas);
      await expect(browser.locator(".source-name b").filter({ hasText: "original-source.png" })).toBeVisible();
      await reopen(second.id, second.name);
      const restored = await api.getSession(sessionId);
      expect(restored.document.layers[0]!.frames["frame-1"]![0]).toBe(1);
      await expect(browser.locator(".source-name b").filter({ hasText: "original-source.png" })).toHaveCount(0);
      expect(restored.project!.revision).toBeGreaterThan(second.revision);
      await expect(browser.getByText("Conflict", { exact: true })).toHaveCount(0);
    }
  });
});

function documentContent(document: PixelDocument): PixelDocument {
  return { ...document, id: "semantic-document", revision: 0, metadata: { ...document.metadata, modifiedBy: "" } };
}

async function canvasImage(page: Page): Promise<string> {
  return page.getByLabel("Pixel canvas").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

async function callTool<T = unknown>(client: Client, name: string, sessionId: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: { session_id: sessionId, response_format: "json", ...args } }) as CallToolResult;
  expect(result.isError, `${name} must succeed`).not.toBe(true);
  expect(result.structuredContent).toHaveProperty("data");
  return (result.structuredContent as { data: T }).data;
}

async function withParitySessions(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  run: (harness: { api: Pick<PixelServerClient, "getSession" | "getHistory">; client: Client; webId: string; mcpId: string; mcpPage: Page; fixture: PixelDocument; sessionHeaders: (id: string) => Record<string, string> }) => Promise<void>
): Promise<void> {
  if (!baseURL) throw new Error("The E2E server baseURL is required.");
  const registry = {
    pid: process.pid,
    port: Number(new URL(baseURL).port),
    daemonToken: "editable-pixel-e2e-daemon-token",
    startedAt: new Date().toISOString()
  };
  const daemonApi = new PixelServerClient(registry, "mcp");
  const sessionAccess = new Map<string, { api: PixelServerClient; token: string }>();
  const access = (id: string) => {
    const session = sessionAccess.get(id);
    if (!session) throw new Error("The requested parity session has not been created.");
    return session;
  };
  const api: Pick<PixelServerClient, "getSession" | "getHistory"> = {
    getSession: (id) => access(id).api.getSession(id),
    getHistory: (id) => access(id).api.getHistory(id)
  };
  const sessionHeaders = (id: string) => ({ Authorization: `Bearer ${access(id).token}` });
  const createSession = async (document: PixelDocument) => {
    const created = await daemonApi.createSession({ document, host: "browser" });
    sessionAccess.set(created.session.id, {
      api: new PixelServerClient({ ...registry, daemonToken: created.persistentToken }, "mcp"),
      token: created.persistentToken
    });
    return created;
  };
  const server = createEditablePixelMcpServer(async () => daemonApi);
  const client = new Client({ name: "editable-pixel-e2e-parity", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let mcpPage: Page | undefined;
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const fixture = parityDocument();
    const webSession = await createSession(structuredClone(fixture));
    const mcpSession = await createSession(structuredClone(fixture));
    mcpPage = await context.newPage();
    await page.goto(`/?session=${webSession.session.id}&bootstrap=${webSession.bootstrapToken}`);
    await mcpPage.goto(`/?session=${mcpSession.session.id}&bootstrap=${mcpSession.bootstrapToken}`);
    for (const browser of [page, mcpPage]) {
      await expect(browser.locator(".status-connected")).toBeVisible();
      await expect(browser.getByLabel("Pixel canvas")).toBeVisible();
    }
    await run({ api, client, webId: webSession.session.id, mcpId: mcpSession.session.id, mcpPage, fixture, sessionHeaders });
  } finally {
    await Promise.all([
      mcpPage?.close(),
      ...[...sessionAccess].map(([id, session]) => session.api.closeSession(id)),
      client.close(),
      server.close(),
      clientTransport.close(),
      serverTransport.close()
    ]);
  }
}
