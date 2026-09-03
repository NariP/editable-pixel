import { createPixelDocument, NEUTRAL_NORMAL, type PixelDocument, type Selection } from "@editable-pixel/document";
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
  run: (harness: { api: PixelServerClient; client: Client; webId: string; mcpId: string; mcpPage: Page; fixture: PixelDocument }) => Promise<void>
): Promise<void> {
  if (!baseURL) throw new Error("The E2E server baseURL is required.");
  const api = new PixelServerClient({
    pid: process.pid,
    port: Number(new URL(baseURL).port),
    daemonToken: "editable-pixel-e2e-daemon-token",
    startedAt: new Date().toISOString()
  }, "mcp");
  const server = createEditablePixelMcpServer(async () => api);
  const client = new Client({ name: "editable-pixel-e2e-parity", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sessionIds: string[] = [];
  let mcpPage: Page | undefined;
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const fixture = parityDocument();
    const webSession = await api.createSession({ document: structuredClone(fixture), host: "browser" });
    sessionIds.push(webSession.session.id);
    const mcpSession = await api.createSession({ document: structuredClone(fixture), host: "browser" });
    sessionIds.push(mcpSession.session.id);
    mcpPage = await context.newPage();
    await page.goto(`/?session=${webSession.session.id}&bootstrap=${webSession.bootstrapToken}`);
    await mcpPage.goto(`/?session=${mcpSession.session.id}&bootstrap=${mcpSession.bootstrapToken}`);
    for (const browser of [page, mcpPage]) {
      await expect(browser.locator(".status-connected")).toBeVisible();
      await expect(browser.getByLabel("Pixel canvas")).toBeVisible();
    }
    await run({ api, client, webId: webSession.session.id, mcpId: mcpSession.session.id, mcpPage, fixture });
  } finally {
    await Promise.all([
      mcpPage?.close(),
      ...sessionIds.map((id) => api.closeSession(id)),
      client.close(),
      server.close(),
      clientTransport.close(),
      serverTransport.close()
    ]);
  }
}
