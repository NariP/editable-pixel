import { NEUTRAL_NORMAL, createPixelDocument } from "@editable-pixel/document";
import { renderPng } from "@editable-pixel/renderer/node";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const daemonToken = "editable-pixel-e2e-daemon-token";
test("CLI isometric controls update the visible grid and shared selection history", async ({ page, request }) => {
  const created = await createSession(request);
  const directory = await mkdtemp(join(tmpdir(), "editable-pixel-cli-e2e-"));
  const registry = join(directory, "server.json");
  await writeFile(registry, JSON.stringify({
    pid: process.pid, port: 4178, daemonToken, startedAt: new Date().toISOString()
  }), { mode: 0o600 });
  const cli = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      resolve("packages/pixel-cli/dist/cli.js"), "--json", ...args, "--session", created.session.id
    ], { env: { ...process.env, EDITABLE_PIXEL_REGISTRY: registry } });
    return JSON.parse(stdout);
  };
  try {
    await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
    await expect(page.locator(".status-connected")).toBeVisible();
    await cli("view", "set", "--grid-mode", "isometric");
    await expect(page.getByLabel("2 to 1 isometric guide")).toBeVisible();
    await expect(page.locator(".pixel-grid-square")).toHaveCount(0);

    const selected = await cli("selection", "diamond", "--center-x", "4", "--center-y", "3", "--width", "8");
    expect(selected.selection).toMatchObject({ type: "mask", x: 1, y: 1, width: 6, height: 4, frameId: "idle-1" });
    await expect(page.getByLabel("16 selected pixels")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".selection-mask-overlay")).toHaveCount(0);
    await cli("redo");
    await expect(page.getByLabel("16 selected pixels")).toBeVisible();
    const historyResponse = await request.get(`/api/sessions/${created.session.id}/history`, { headers: authorization() });
    expect((await historyResponse.json()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "ai", client: "cli" })
    ]));

    await cli("view", "set", "--grid", "hide");
    await expect(page.locator(".pixel-grid")).toHaveCount(0);
    await cli("view", "set", "--grid", "show");
    await expect(page.getByLabel("2 to 1 isometric guide")).toBeVisible();
    await cli("view", "set", "--grid-mode", "square");
    await expect(page.locator(".pixel-grid-square")).toBeVisible();
    await expect(page.locator(".pixel-grid-isometric")).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser selection synchronizes with the session and survives reconnect", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);

  const sessionDetails = page.getByRole("button", { name: "Session details" });
  await expect(sessionDetails).toContainText(`Session ${created.session.id.slice(0, 8)}`);
  await expect(sessionDetails).toContainText("Codex connected");
  await expect(page.locator(".status-connected")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("bootstrap=");
  await expect(page.locator(".canvas-toolbar")).not.toContainText("1600%");
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(page.locator(".canvas-toolbar")).not.toContainText("1600%");
  const mcpRead = await request.get(`/api/sessions/${created.session.id}`, {
    headers: authorization("mcp")
  });
  expect(mcpRead.ok()).toBeTruthy();
  await sessionDetails.click();
  const sessionPopover = page.locator(".session-popover");
  await expect(sessionPopover).toBeVisible();
  await expect(sessionPopover.locator(".session-clients")).toContainText("WEB");
  await expect(sessionPopover.locator(".session-clients")).toContainText("MCP");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Select", exact: true }).click();
  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");
  await page.mouse.move(box.x + box.width * 1.2 / 8, box.y + box.height * 1.2 / 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 4.2 / 8, box.y + box.height * 3.2 / 6);
  await page.mouse.up();

  await expect(page.getByText("Editing within selection · 1,1 / 4×3 · Esc to clear")).toBeVisible();
  await expect(page.locator(".selection-shade")).toHaveCount(4);
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}/selection`, {
      headers: authorization()
    });
    return (await response.json() as { selection: unknown }).selection;
  }).toEqual({
    type: "rect",
    x: 1,
    y: 1,
    width: 4,
    height: 3,
    layerId: "artwork",
    frameId: "idle-1"
  });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("No selection")).toBeVisible();
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}/selection`, { headers: authorization() });
    return (await response.json() as { selection: unknown }).selection;
  }).toBeNull();

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Editing within selection · 1,1 / 4×3 · Esc to clear")).toBeVisible();
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}/selection`, { headers: authorization() });
    return (await response.json() as { selection: unknown }).selection;
  }).toEqual({
    type: "rect",
    x: 1,
    y: 1,
    width: 4,
    height: 3,
    layerId: "artwork",
    frameId: "idle-1"
  });

  await page.reload();
  await expect(page.locator(".status-connected")).toBeVisible();
  await expect(page.getByText("Editing within selection · 1,1 / 4×3 · Esc to clear")).toBeVisible();
});

test("AI selection and immediate edits use the visible Select tool and shared browser history", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  await page.getByRole("button", { name: "Pen" }).click();
  await expect(page.getByRole("button", { name: "Pen" })).toHaveAttribute("aria-pressed", "true");

  const selected = await request.post(`/api/sessions/${created.session.id}/selection-command`, {
    headers: authorization("mcp"),
    data: {
      command: { type: "rect", x: 1, y: 1, width: 2, height: 2, mode: "replace" }
    }
  });
  expect(selected.ok()).toBeTruthy();
  await expect(page.getByText("Editing within selection · 1,1 / 2×2 · Esc to clear")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".selection-shade")).toHaveCount(4);

  const edited = await request.post(`/api/sessions/${created.session.id}/actions`, {
    headers: authorization("mcp"),
    data: {
      reason: "Paint AI-selected highlight",
      action: { type: "paint_selection", colorIndex: 2 }
    }
  });
  expect(edited.ok()).toBeTruthy();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 2, changed: 2 });

  const history = await (await request.get(`/api/sessions/${created.session.id}/history`, {
    headers: authorization("mcp")
  })).json() as { entries: Array<{ actor: string; client?: string; reason: string; state: string }> };
  expect(history.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({
      actor: "ai",
      client: "mcp",
      reason: "Paint AI-selected highlight",
      state: "applied"
    })
  ]));

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 3, changed: 0 });
  await expect(page.getByText("Editing within selection · 1,1 / 2×2 · Esc to clear")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 4, changed: 2 });
});

test("semantic MCP web commands read and operate the connected browser without pixel-coordinate clicks", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const contextResponse = await request.post(`/api/sessions/${created.session.id}/web-command`, {
    headers: authorization("mcp"),
    data: { command: { type: "get_context" } }
  });
  expect(contextResponse.ok()).toBeTruthy();
  const { result: context } = await contextResponse.json() as { result: {
    view: { inspectorTab: string; showGrid: boolean };
    active: { frameId: string; layerId: string };
    capabilities: { files: string[]; export: string[] };
  }};
  expect(context).toMatchObject({
    view: { inspectorTab: "convert", showGrid: true },
    active: { frameId: "idle-1", layerId: "artwork" }
  });
  expect(context.capabilities.files).toContain("open-project");
  expect(context.capabilities.export).toEqual(expect.arrayContaining(["png", "normal", "lit", "gif", "json"]));

  const controlled = await request.post(`/api/sessions/${created.session.id}/web-command`, {
    headers: authorization("mcp"),
    data: { command: { type: "set_view", inspectorTab: "edit", tool: "select", showGrid: false } }
  });
  expect(controlled.ok()).toBeTruthy();
  await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Square grid", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "2:1 isometric grid", exact: true })).toHaveAttribute("aria-pressed", "false");

  const importedDocument = createPixelDocument({
    id: "ai-imported-document",
    width: 4,
    height: 4,
    palette: ["#00000000", "#ff007aff"],
    pixels: [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1]
  });
  const imported = await request.post(`/api/sessions/${created.session.id}/web-command`, {
    headers: authorization("mcp"),
    data: {
      command: {
        type: "import_files",
        purpose: "replace-canvas",
        files: [{
          name: "ai-import.pixel.json",
          mimeType: "application/json",
          dataBase64: Buffer.from(JSON.stringify(importedDocument)).toString("base64")
        }]
      }
    }
  });
  expect(imported.ok()).toBeTruthy();
  await expect(page.getByLabel("Pixel canvas")).toHaveJSProperty("width", 4);
  await expect(page.getByLabel("Pixel canvas")).toHaveJSProperty("height", 4);
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}/history`, { headers: authorization("mcp") });
    const history = await response.json() as { entries: Array<{ actor: string; reason: string; state: string }> };
    return history.entries.some((entry) => entry.actor === "ai" && entry.state === "applied" && entry.reason.includes("Replace canvas"));
  }).toBe(true);
});

test("the connected session document wins over a stale cached working document", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const staleDocument = createPixelDocument({ width: 64, height: 64 });
  staleDocument.revision = 999;
  const settings = {
    canvasWidth: 64,
    canvasHeight: 64,
    colorCount: 16,
    contentScale: 0.8,
    alignment: "center" as const,
    dithering: "none" as const,
    background: "alpha" as const
  };
  await page.evaluate(({ key, snapshot }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("editable-pixel-workspaces", 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions");
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("success", () => {
      const transaction = request.result.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put(snapshot, key);
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", () => reject(transaction.error));
    });
  }), {
    key: "session:previous-workspace",
    snapshot: {
      version: 1,
      draftSettings: settings,
      workingDocument: staleDocument,
      sources: [{
        id: "stale-source",
        name: "stale.pixel.json",
        mimeType: "application/json",
        variants: [{
          id: "stale-variant",
          name: "V1",
          document: staleDocument,
          appliedSettings: settings,
          hasEditsSinceConversion: false,
          createdAt: new Date(0).toISOString()
        }]
      }],
      activeSourceId: "stale-source",
      activeVariantId: "stale-variant",
      activeInspectorTab: "edit"
    }
  });

  await page.goto(`/?session=${created.session.id}&workspace=previous-workspace`);
  await expect(page.locator(".status-connected")).toBeVisible();
  await expect(page.getByLabel("Pixel canvas")).toHaveJSProperty("width", 8);
  await expect(page.getByLabel("Pixel canvas")).toHaveJSProperty("height", 6);
  await expect(page.getByRole("navigation", { name: "Project location" })).not.toContainText("V1");
  await expect.poll(() => page.url()).not.toContain("workspace=");
});

test("Z-drag zooms the chosen canvas area", async ({ page }) => {
  await page.goto("/");
  const zoomLabel = page.locator(".zoom-control > span");
  const before = Number((await zoomLabel.textContent())?.replace("%", ""));
  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");

  await page.keyboard.down("z");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.up();
  await page.keyboard.up("z");

  await expect.poll(async () => Number((await zoomLabel.textContent())?.replace("%", ""))).toBeGreaterThan(before);
});

test("layer handles smoothly reorder the visible render stack", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Add layer" }).click();

  const layersSection = page.getByRole("heading", { name: "Layers" }).locator("..").locator("..");
  await expect(layersSection.locator(".compact-actions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete layer" })).toHaveCount(0);

  const layerNames = page.locator(".layer-select b");
  await expect(layerNames).toHaveText(["Layer 2", "Artwork"]);
  await expect(page.getByRole("button", { name: "Hide Layer 2" })).toBeVisible();

  const source = page.getByRole("button", { name: "Reorder Layer 2" });
  await expect(source).toHaveCSS("touch-action", "none");
  const target = page.getByRole("button", { name: "Reorder Artwork" });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Layer drag handles are not visible.");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2 + 8, { steps: 3 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(layerNames).toHaveText(["Artwork", "Layer 2"]);

  await page.getByRole("button", { name: "Select Layer 2 layer" }).dblclick();
  const nameInput = page.getByRole("textbox", { name: "Rename Layer 2" });
  await nameInput.fill("Highlights");
  await nameInput.press("Enter");
  const highlights = page.getByRole("button", { name: "Select Highlights layer" });
  await expect(highlights).toBeVisible();

  await highlights.click();
  await expect(page.locator(".stack-item.active")).toHaveClass(/keyboard-target/);
  await expect(page.locator(".pixel-canvas-shell")).not.toHaveClass(/keyboard-target/);
  await page.keyboard.press("Meta+C");
  await page.keyboard.press("Meta+V");
  await expect(page.getByRole("button", { name: "Select Highlights copy layer" })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("button", { name: "Select Highlights copy layer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select Artwork layer" })).toHaveAttribute("aria-pressed", "true");

  const canvas = page.locator(".pixel-canvas-shell");
  await canvas.click({ position: { x: 12, y: 12 } });
  await expect(canvas).toHaveClass(/keyboard-target/);
  await expect(page.locator(".stack-item.keyboard-target")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(layerNames).toHaveText(["Artwork", "Highlights"]);
});

test("Escape clears the selection mask and participates in local undo and redo", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.up();

  const selectionStatus = page.locator(".canvas-footer span").last();
  await expect(selectionStatus).toContainText("Editing within selection");
  const selected = await selectionStatus.textContent();
  await expect(page.locator(".selection-shade")).toHaveCount(4);
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(selectionStatus).toHaveText("No selection");
  await expect(page.locator(".selection-shade")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(selectionStatus).toHaveText(selected ?? "");
  await expect(page.locator(".selection-shade")).toHaveCount(4);
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(selectionStatus).toHaveText("No selection");
  await expect(page.getByRole("toolbar", { name: "Selection actions" })).toHaveCount(0);
});

test("Delete, Backspace, and Cmd+X clear selected pixels while Escape only deselects", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const selection = {
    type: "rect",
    x: 2,
    y: 1,
    width: 4,
    height: 1,
    layerId: "artwork",
    frameId: "idle-1"
  };
  const selected = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection }
  });
  expect(selected.ok()).toBeTruthy();

  const sessionState = async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      revision: number;
      document: {
        selection?: typeof selection;
        layers: Array<{ id: string; frames: Record<string, number[]> }>;
      };
    };
    const pixels = session.document.layers.find((layer) => layer.id === "artwork")!.frames["idle-1"]!;
    return { revision: session.revision, pixels: pixels.slice(10, 14), selection: session.document.selection ?? null };
  };
  const selectedPixels = async () => {
    const state = await sessionState();
    return { pixels: state.pixels, selection: state.selection };
  };
  const waitForUiSync = async () => {
    const { revision } = await sessionState();
    await expect.poll(async () => {
      const status = await page.locator(".canvas-footer span").first().textContent();
      return Number(status?.match(/revision (\d+)\./)?.[1] ?? -1);
    }).toBeGreaterThanOrEqual(revision);
  };

  const selectionStatus = page.locator(".canvas-footer span").last();
  await expect(selectionStatus).toContainText("Editing within selection");
  await expect.poll(selectedPixels).toEqual({ pixels: [1, 1, 1, 1], selection });

  await page.keyboard.press("Backspace");
  await expect.poll(selectedPixels).toEqual({ pixels: [0, 0, 0, 0], selection });
  await expect(selectionStatus).toContainText("Editing within selection");
  await page.keyboard.press("Meta+Z");
  await expect.poll(selectedPixels).toEqual({ pixels: [1, 1, 1, 1], selection });
  await waitForUiSync();

  await page.keyboard.press("Delete");
  await expect.poll(selectedPixels).toEqual({ pixels: [0, 0, 0, 0], selection });
  await page.keyboard.press("Meta+Z");
  await expect.poll(selectedPixels).toEqual({ pixels: [1, 1, 1, 1], selection });
  await waitForUiSync();

  await page.keyboard.press("Meta+X");
  await expect.poll(selectedPixels).toEqual({ pixels: [0, 0, 0, 0], selection });
  await page.keyboard.press("Meta+Z");
  await expect.poll(selectedPixels).toEqual({ pixels: [1, 1, 1, 1], selection });
  await waitForUiSync();

  const canvas = page.getByLabel("Pixel canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("Pixel canvas is not visible.");
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.05, canvasBox.y + canvasBox.height * 0.8);
  await expect.poll(async () => (await sessionState()).selection).toMatchObject({ x: 0, y: 4 });
  await waitForUiSync();
  await page.keyboard.press("Meta+V");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as { document: { layers: Array<{ id: string; frames: Record<string, number[]> }> } };
    return session.document.layers.find((layer) => layer.id === "artwork")!.frames["idle-1"]!.slice(32, 36);
  }).toEqual([1, 1, 1, 1]);
  await waitForUiSync();
  await page.keyboard.press("Meta+Z");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as { document: { layers: Array<{ id: string; frames: Record<string, number[]> }> } };
    return session.document.layers.find((layer) => layer.id === "artwork")!.frames["idle-1"]!.slice(32, 36);
  }).toEqual([0, 0, 0, 0]);
  await waitForUiSync();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await sessionState()).selection).toBeNull();
  await expect(selectionStatus).toHaveText("No selection");
});

test("Cmd+C and V paste at a newly selected destination and Cmd+Z undoes atomically", async ({ page, request }) => {
  const created = await createSession(request);
  // Keep the server behind the optimistic canvas to exercise real commit completion.
  await page.routeWebSocket(`**/api/sessions/${created.session.id}/ws?*`, (socket) => {
    const server = socket.connectToServer();
    let messages = Promise.resolve();
    socket.onMessage((message) => {
      messages = messages.then(async () => {
        if (JSON.parse(String(message)).type === "document.patch") {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        server.send(message);
      });
    });
  });
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);

  const beforeResponse = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
  type ClipboardSession = {
    revision: number;
    selection: { x: number; y: number; width: number; height: number; layerId: string; frameId: string };
    document: {
      canvas: { width: number };
      layers: Array<{ id: string; frames: Record<string, number[]> }>;
    };
  };
  const waitForUiSync = async (revision: number) => {
    await expect.poll(async () => {
      const status = await page.locator(".canvas-footer span").first().textContent();
      return Number(status?.match(/revision (\d+)\./)?.[1] ?? -1);
    }).toBeGreaterThanOrEqual(revision);
  };
  const before = await beforeResponse.json() as ClipboardSession;
  await waitForUiSync(before.revision);
  const sourcePixels = before.document.layers.find((layer) => layer.id === before.selection.layerId)!.frames[before.selection.frameId]!;
  const copied = Array.from({ length: before.selection.height }, (_, y) =>
    sourcePixels.slice(
      (before.selection.y + y) * before.document.canvas.width + before.selection.x,
      (before.selection.y + y) * before.document.canvas.width + before.selection.x + before.selection.width
    )
  );

  await page.evaluate(() => {
    window.addEventListener("copy", (event) => {
      document.body.dataset.pixelClipboard = event.clipboardData?.getData("text/plain") ?? "";
    }, { once: true });
  });
  await page.keyboard.press("Meta+C");
  await expect.poll(async () => {
    const serialized = await page.locator("body").getAttribute("data-pixel-clipboard");
    return serialized ? JSON.parse(serialized) : undefined;
  }).toMatchObject({
    format: "editable-pixel-selection",
    version: 1,
    width: before.selection.width,
    height: before.selection.height,
    pixels: copied.flat()
  });

  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const document = await response.json() as ClipboardSession;
    return document.selection.x !== before.selection.x || document.selection.y !== before.selection.y
      ? document.selection
      : undefined;
  }).toBeDefined();
  const destinationResponse = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
  const destination = await destinationResponse.json() as ClipboardSession;
  await waitForUiSync(destination.revision);
  const destinationPixels = destination.document.layers.find((layer) => layer.id === destination.selection.layerId)!.frames[destination.selection.frameId]!;
  const originalDestination = Array.from({ length: destination.selection.height }, (_, y) =>
    destinationPixels.slice(
      (destination.selection.y + y) * destination.document.canvas.width + destination.selection.x,
      (destination.selection.y + y) * destination.document.canvas.width + destination.selection.x + destination.selection.width
    )
  );
  await page.keyboard.press("Meta+V");

  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const document = await response.json() as ClipboardSession;
    // Selecting the destination already advanced the revision; wait for the paste itself.
    return document.revision > destination.revision ? document : undefined;
  }).toBeDefined();
  const afterResponse = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
  const after = await afterResponse.json() as ClipboardSession;
  expect(after.selection.x).toBe(destination.selection.x);
  expect(after.selection.y).toBe(destination.selection.y);
  const targetPixels = after.document.layers.find((layer) => layer.id === after.selection.layerId)!.frames[after.selection.frameId]!;
  const pastedPixels = Array.from({ length: after.selection.height }, (_, y) =>
    targetPixels.slice(
      (after.selection.y + y) * after.document.canvas.width + after.selection.x,
      (after.selection.y + y) * after.document.canvas.width + after.selection.x + after.selection.width
    )
  );
  expect(pastedPixels).toEqual(copied);
  await waitForUiSync(after.revision);

  await page.keyboard.press("Meta+Z");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const document = await response.json() as ClipboardSession;
    return document.revision > after.revision ? document.selection : undefined;
  }).toMatchObject(destination.selection);
  const undoneResponse = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
  const undone = await undoneResponse.json() as ClipboardSession;
  await waitForUiSync(undone.revision);
  await page.evaluate(() => {
    window.addEventListener("copy", (event) => {
      document.body.dataset.pixelClipboardAfterUndo = event.clipboardData?.getData("text/plain") ?? "";
    }, { once: true });
  });
  await page.keyboard.press("Meta+C");
  await expect.poll(async () => {
    const serialized = await page.locator("body").getAttribute("data-pixel-clipboard-after-undo");
    return serialized ? (JSON.parse(serialized) as { pixels: number[] }).pixels : undefined;
  }).toEqual(originalDestination.flat());

  await page.keyboard.press("Meta+Shift+Z");
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const document = await response.json() as ClipboardSession;
    return document.revision > undone.revision ? document : undefined;
  }).toBeDefined();
  const redoneResponse = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
  const redone = await redoneResponse.json() as ClipboardSession;
  const redonePixels = redone.document.layers.find((layer) => layer.id === redone.selection.layerId)!.frames[redone.selection.frameId]!;
  const restoredPaste = Array.from({ length: redone.selection.height }, (_, y) =>
    redonePixels.slice(
      (redone.selection.y + y) * redone.document.canvas.width + redone.selection.x,
      (redone.selection.y + y) * redone.document.canvas.width + redone.selection.x + redone.selection.width
    )
  );
  expect(restoredPaste).toEqual(copied);
});

test("a visible Normal selection takes clipboard priority over layer focus", async ({ page, request }) => {
  const normalPixels = new Array<number>(8 * 6).fill(NEUTRAL_NORMAL);
  const copiedNormals = [0x6080ff, 0x7088ff, 0x9098ff, 0xa0a0ff];
  normalPixels.splice(10, copiedNormals.length, ...copiedNormals);
  const created = await createSession(request, { normalPixels });
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  await page.getByRole("tab", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Normal", exact: true }).click();

  const sourceSelection = {
    type: "rect",
    x: 2,
    y: 1,
    width: 4,
    height: 1,
    layerId: "artwork",
    frameId: "idle-1"
  };
  const selectedSource = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection: sourceSelection }
  });
  expect(selectedSource.ok()).toBeTruthy();
  await expect(page.getByText("Editing within selection · 2,1 / 4×1 · Esc to clear")).toBeVisible();

  const artwork = page.getByRole("button", { name: "Select Artwork layer" });
  await artwork.click();
  await expect(artwork.locator("..")).toHaveClass(/keyboard-target/);
  await page.evaluate(() => {
    window.addEventListener("copy", (event) => {
      document.body.dataset.normalPixelClipboard = event.clipboardData?.getData("text/plain") ?? "";
    }, { once: true });
  });
  await page.keyboard.press("Meta+C");
  await expect.poll(async () => {
    const serialized = await page.locator("body").getAttribute("data-normal-pixel-clipboard");
    return serialized ? JSON.parse(serialized) : undefined;
  }).toMatchObject({
    format: "editable-pixel-selection",
    version: 1,
    map: "normal",
    width: 4,
    height: 1,
    pixels: copiedNormals
  });

  const destinationSelection = { ...sourceSelection, x: 2, y: 4 };
  const selectedDestination = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection: destinationSelection }
  });
  expect(selectedDestination.ok()).toBeTruthy();
  await expect(page.getByText("Editing within selection · 2,4 / 4×1 · Esc to clear")).toBeVisible();
  await artwork.click();
  await expect(artwork.locator("..")).toHaveClass(/keyboard-target/);
  await page.keyboard.press("Meta+V");

  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      document: { layers: Array<{ id: string; normalFrames?: Record<string, number[]> }> };
    };
    const layer = session.document.layers.find((candidate) => candidate.id === "artwork")!;
    return {
      layers: session.document.layers.length,
      normals: layer.normalFrames?.["idle-1"]?.slice(34, 38)
    };
  }).toEqual({ layers: 1, normals: copiedNormals });
});

test("Cmd+V stamps one copied pixel into every pixel in a multi-selection", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const sourceSelection = {
    type: "rect",
    x: 2,
    y: 1,
    width: 1,
    height: 1,
    layerId: "artwork",
    frameId: "idle-1"
  };
  const selectedSource = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection: sourceSelection }
  });
  expect(selectedSource.ok()).toBeTruthy();
  await expect(page.getByText("Editing within selection · 2,1 / 1×1 · Esc to clear")).toBeVisible();
  await page.keyboard.press("Meta+C");

  const destinationSelection = {
    type: "mask",
    x: 0,
    y: 0,
    width: 8,
    height: 6,
    layerId: "artwork",
    frameId: "idle-1",
    indices: [0, 7, 47]
  };
  const selectedDestination = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection: destinationSelection }
  });
  expect(selectedDestination.ok()).toBeTruthy();
  await expect(page.getByText("Editing within selection · 3 pixels · Esc to clear")).toBeVisible();

  await page.keyboard.press("Meta+V");
  const selectedColors = async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      document: {
        selection?: typeof destinationSelection;
        layers: Array<{ id: string; frames: Record<string, number[]> }>;
      };
    };
    const pixels = session.document.layers.find((layer) => layer.id === "artwork")!.frames["idle-1"]!;
    return {
      colors: destinationSelection.indices.map((index) => pixels[index]),
      selection: session.document.selection
    };
  };
  await expect.poll(selectedColors).toEqual({ colors: [1, 1, 1], selection: destinationSelection });

  await page.keyboard.press("Meta+Z");
  await expect.poll(selectedColors).toEqual({ colors: [0, 0, 0], selection: destinationSelection });
});

test("Shift+1 restores the fitted canvas zoom", async ({ page }) => {
  await page.goto("/");
  const zoomLabel = page.locator(".zoom-control > span");
  const fitted = await zoomLabel.textContent();

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomLabel).not.toHaveText(fitted ?? "");
  await page.keyboard.press("Shift+1");

  await expect(zoomLabel).toHaveText(fitted ?? "");
});

test("a bounded agent patch is previewed, rejected outside selection, and applied from the web editor", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  await expect(page.getByLabel("Content alignment")).toContainText("Center");

  const selection = {
    type: "rect",
    x: 1,
    y: 1,
    width: 2,
    height: 2,
    layerId: "artwork",
    frameId: "idle-1"
  };
  const selected = await request.post(`/api/sessions/${created.session.id}/selection`, {
    headers: authorization(),
    data: { selection }
  });
  expect(selected.ok()).toBeTruthy();

  const outside = await request.post(`/api/sessions/${created.session.id}/patches/create`, {
    headers: authorization(),
    data: { reason: "outside attempt", changes: [{ x: 7, y: 5, colorIndex: 2 }] }
  });
  expect(outside.status()).toBe(400);
  await expect(outside.json()).resolves.toMatchObject({ error: { code: "PATCH_INVALID" } });

  const patchResponse = await request.post(`/api/sessions/${created.session.id}/patches/create`, {
    headers: authorization(),
    data: { reason: "Make the selected eye light", changes: [{ x: 1, y: 1, colorIndex: 2 }] }
  });
  expect(patchResponse.ok()).toBeTruthy();
  const { patch } = await patchResponse.json() as { patch: { id: string } };
  const preview = await request.post(`/api/sessions/${created.session.id}/patches/preview`, {
    headers: authorization(),
    data: { patch }
  });
  expect(preview.ok()).toBeTruthy();

  await expect(page.getByText("AGENT PATCH / REVIEW REQUIRED")).toBeVisible();
  await expect(page.getByText("Make the selected eye light")).toBeVisible();
  await page.getByRole("button", { name: "APPLY PATCH" }).click();

  await expect(page.getByText("AGENT PATCH / REVIEW REQUIRED")).toBeHidden();
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      revision: number;
      document: { layers: Array<{ id: string; frames: Record<string, number[]> }> };
    };
    return {
      revision: session.revision,
      changed: session.document.layers.find((layer) => layer.id === "artwork")?.frames["idle-1"]?.[9]
    };
  }).toEqual({ revision: 2, changed: 2 });

  await page.getByRole("button", { name: /Undo/ }).click();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 3, changed: 0 });
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 4, changed: 2 });

  const rejectedPatchResponse = await request.post(`/api/sessions/${created.session.id}/patches/create`, {
    headers: authorization(),
    data: { reason: "Keep the reviewed eye unchanged", changes: [{ x: 1, y: 1, colorIndex: 1 }] }
  });
  const rejectedPatch = await rejectedPatchResponse.json() as { patch: { id: string } };
  const rejectedPreview = await request.post(`/api/sessions/${created.session.id}/patches/preview`, {
    headers: authorization(),
    data: rejectedPatch
  });
  expect(rejectedPreview.ok()).toBeTruthy();
  await expect(page.getByText("Keep the reviewed eye unchanged")).toBeVisible();
  await page.getByRole("button", { name: "REJECT" }).click();
  await expect(page.getByText("Keep the reviewed eye unchanged")).toBeHidden();
  await expect.poll(() => sessionPixel(request, created.session.id)).toEqual({ revision: 4, changed: 2 });

  const beforePaletteAddition = await (await request.get(`/api/sessions/${created.session.id}`, {
    headers: authorization()
  })).json() as { document: { palette: string[] } };
  const newColorIndex = beforePaletteAddition.document.palette.length;
  const palettePatchResponse = await request.post(`/api/sessions/${created.session.id}/patches/create`, {
    headers: authorization(),
    data: {
      reason: "Add a new violet accent inside selection",
      newColors: ["#7c3aedff"],
      changes: [{ x: 2, y: 2, colorIndex: newColorIndex }]
    }
  });
  expect(palettePatchResponse.ok()).toBeTruthy();
  const palettePatch = await palettePatchResponse.json() as { patch: { id: string } };
  await request.post(`/api/sessions/${created.session.id}/patches/preview`, {
    headers: authorization(),
    data: palettePatch
  });
  await expect(page.getByText(/\+1 colors/)).toBeVisible();
  await page.getByRole("button", { name: "APPLY PATCH" }).click();
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const current = await response.json() as { document: { palette: string[]; layers: Array<{ id: string; frames: Record<string, number[]> }> } };
    return {
      color: current.document.palette[newColorIndex],
      changed: current.document.layers.find((layer) => layer.id === "artwork")?.frames["idle-1"]?.[18],
      nonTarget: current.document.layers.find((layer) => layer.id === "artwork")?.frames["idle-1"]?.[0]
    };
  }).toEqual({ color: "#7c3aedff", changed: newColorIndex, nonTarget: 0 });
});

test("rapid connected-canvas edits keep sequential revisions without conflicts", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  await page.getByRole("button", { name: "Pen" }).click();
  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");

  await page.mouse.move(box.x + box.width * 0.5 / 8, box.y + box.height * 0.5 / 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 4.5 / 8, box.y + box.height * 0.5 / 6, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      revision: number;
      document: { layers: Array<{ id: string; frames: Record<string, number[]> }> };
    };
    return {
      revisionAdvanced: session.revision > 0,
      stroke: session.document.layers.find((layer) => layer.id === "artwork")?.frames["idle-1"]?.slice(0, 5)
    };
  }).toEqual({ revisionAdvanced: true, stroke: [1, 1, 1, 1, 1] });
  await expect(page.locator(".status-connected")).toBeVisible();
});

test("offline pixel edits stay visible, queue locally, and flush after reconnect", async ({ page, request, context }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  const canvas = page.getByLabel("Pixel canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Pixel canvas is not visible.");
  const beforeImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());

  await context.setOffline(true);
  await expect(page.locator(".status-reconnecting")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Pen" }).click();
  await page.mouse.click(box.x + box.width * 1.2 / 8, box.y + box.height * 1.2 / 6);
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(beforeImage);
  await expect(page.locator(".canvas-footer")).toContainText("queued until the local session reconnects");
  expect((await sessionPixel(request, created.session.id)).changed).toBe(0);

  await context.setOffline(false);
  await expect(page.locator(".status-connected")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await sessionPixel(request, created.session.id)).changed, { timeout: 15_000 }).toBe(1);
  await expect(page.locator(".status-conflict")).toHaveCount(0);
});

test("keeps the previous conversion preview visible while a fixed palette removal reconverts", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const source = await renderPng(createPixelDocument({
    width: 2,
    height: 1,
    palette: ["#00000000", "#ff0000ff", "#0000ffff"],
    pixels: [1, 2]
  }));
  const canvas = page.getByLabel("Pixel canvas");
  const blankImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.locator('input[type="file"]').setInputFiles({
    name: "palette-preview.png",
    mimeType: "image/png",
    buffer: source
  });
  await page.getByRole("button", { name: /Replace Canvas/ }).click();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()), { timeout: 10_000 }).not.toBe(blankImage);

  const appliedImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByRole("button", { name: "Add fixed palette color" }).click();
  await page.getByLabel("Choose fixed palette color", { exact: true }).fill("#00ff00");
  await page.getByRole("button", { name: "Add color" }).click();
  await page.getByRole("button", { name: "Add fixed palette color" }).click();
  await page.getByLabel("Choose fixed palette color", { exact: true }).fill("#ffff00");
  await page.getByRole("button", { name: "Add color" }).click();

  const surface = page.locator(".canvas-surface");
  await expect(surface).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()), { timeout: 10_000 }).not.toBe(appliedImage);
  const twoColorPreview = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  expect(twoColorPreview).not.toBe(appliedImage);

  await page.getByRole("button", { name: "Remove fixed palette color 2" }).click();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(twoColorPreview);
  await expect(surface).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });

  const oneColorPreview = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.getByLabel("Background mode").click();
  await page.getByRole("option", { name: "Solid" }).click();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(oneColorPreview);
  await expect(surface).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
});

test("commits numeric conversion inputs only after they lose focus", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();

  const source = await renderPng(createPixelDocument({
    width: 8,
    height: 1,
    palette: ["#00000000", "#ff0000ff", "#ff7f00ff", "#ffff00ff", "#00ff00ff", "#00ffffff", "#0000ffff", "#4b0082ff", "#9400d3ff"],
    pixels: [1, 2, 3, 4, 5, 6, 7, 8]
  }));
  const canvas = page.getByLabel("Pixel canvas");
  const blankImage = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  await page.locator('input[type="file"]').setInputFiles({
    name: "color-count.png",
    mimeType: "image/png",
    buffer: source
  });
  await page.getByRole("button", { name: /Replace Canvas/ }).click();
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()), { timeout: 10_000 }).not.toBe(blankImage);

  const before = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const colorCount = page.getByLabel("Color count");
  await colorCount.fill("4");
  await page.waitForTimeout(500);
  expect(await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL())).toBe(before);

  await colorCount.press("Tab");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()), { timeout: 10_000 }).not.toBe(before);
});

test("retained-source and sprite-sheet import purposes preserve their distinct ownership", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  const first = await renderPng(createPixelDocument({
    width: 2, height: 1, palette: ["#00000000", "#ff0000ff"], pixels: [1, 0]
  }));
  const replacement = await renderPng(createPixelDocument({
    width: 2, height: 1, palette: ["#00000000", "#0000ffff"], pixels: [0, 1]
  }));
  const spriteSheet = await renderPng(createPixelDocument({
    width: 2, height: 1, palette: ["#00000000", "#ff0000ff", "#0000ffff"], pixels: [1, 2]
  }));
  const initialRevision = (await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() }).then((response) => response.json()) as { revision: number }).revision;

  await page.locator('input[type="file"]').setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: first });
  await page.getByRole("button", { name: /Add Source/ }).click();
  await expect(page.getByLabel("1 source")).toBeVisible();
  await expect(page.locator(".source-name b").filter({ hasText: /^reference\.png$/ })).toBeVisible();
  expect((await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() }).then((response) => response.json()) as { revision: number }).revision).toBe(initialRevision);

  await page.locator('input[type="file"]').setInputFiles({ name: "reference-updated.png", mimeType: "image/png", buffer: replacement });
  await page.getByRole("button", { name: /Replace Source/ }).click();
  await expect(page.getByLabel("1 source")).toBeVisible();
  await expect(page.locator(".source-name b").filter({ hasText: /^reference-updated\.png$/ })).toBeVisible();
  await expect(page.locator(".source-name b").filter({ hasText: /^reference\.png$/ })).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles({ name: "walk-sheet.png", mimeType: "image/png", buffer: spriteSheet });
  await page.getByRole("button", { name: /Import Sprite Sheet/ }).click();
  const columns = page.getByLabel("Sprite sheet columns");
  await columns.fill("2");
  await columns.press("Tab");
  const rows = page.getByLabel("Sprite sheet rows");
  await rows.fill("1");
  await rows.press("Tab");
  await page.getByRole("button", { name: "Import 2 frames" }).click();
  await page.getByRole("tab", { name: "Frames" }).click();
  await expect(page.getByLabel("3 frames")).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    return (await response.json() as { document: { frames: unknown[] } }).document.frames.length;
  }).toBe(3);
});

test("multiple AI images become ordered clip frames and export as a real GIF", async ({ page, request }) => {
  const created = await createSession(request);
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect(page.locator(".status-connected")).toBeVisible();
  const red = await renderPng(createPixelDocument({
    width: 2, height: 2, palette: ["#00000000", "#ff0000ff"], pixels: [0, 1, 1, 0]
  }));
  const blue = await renderPng(createPixelDocument({
    width: 2, height: 2, palette: ["#00000000", "#0000ffff"], pixels: [1, 0, 0, 1]
  }));

  await page.getByLabel("Canvas preset").click();
  await page.getByRole("option", { name: "Custom" }).click();
  await page.getByLabel("Canvas width").fill("24");
  await page.getByLabel("Canvas height").fill("16");
  await page.getByRole("button", { name: "Add fixed palette color" }).click();
  await page.getByLabel("Choose fixed palette color", { exact: true }).fill("#ff0000");
  await page.getByRole("button", { name: "Add color" }).click();
  await page.getByRole("button", { name: "Add fixed palette color" }).click();
  await page.getByLabel("Choose fixed palette color", { exact: true }).fill("#0000ff");
  await page.getByRole("button", { name: "Add color" }).click();
  await expect(page.getByLabel("Canvas width")).toHaveValue("24");
  await expect(page.getByLabel("Canvas height")).toHaveValue("16");
  await expect(page.getByLabel("Fixed palette color 1", { exact: true })).toHaveValue("#ff0000");
  await expect(page.getByLabel("Fixed palette color 2", { exact: true })).toHaveValue("#0000ff");

  await page.locator('input[type="file"]').setInputFiles([
    { name: "red-ai.png", mimeType: "image/png", buffer: red },
    { name: "blue-ai.png", mimeType: "image/png", buffer: blue }
  ]);
  await expect(page.getByRole("dialog", { name: "Choose an import purpose" })).toBeVisible();
  await page.getByRole("button", { name: /Add as Frames/ }).click();

  await page.getByRole("tab", { name: "Frames" }).click();
  await expect(page.getByLabel("3 frames")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Select Frame 3 frame" })).toBeVisible();
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    const session = await response.json() as {
      revision: number;
      document: { canvas: { width: number; height: number }; palette: string[]; frames: unknown[] };
    };
    return { canvas: session.document.canvas, palette: session.document.palette, frames: session.document.frames.length };
  }).toEqual({
    canvas: { width: 8, height: 6 },
    palette: ["#00000000", "#ff7a00ff", "#00dff7ff"],
    frames: 3
  });

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("button", { name: "GIF" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Current Clip GIF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("GIF download did not produce a local file.");
  expect((await readFile(downloadPath)).subarray(0, 6).toString("ascii")).toBe("GIF89a");

  await page.reload();
  await expect(page.locator(".status-connected")).toBeVisible();
  await page.getByRole("tab", { name: "Frames" }).click();
  await expect(page.getByLabel("3 frames")).toBeVisible();
});

test("Codex-width layout keeps the canvas visible and opens the inspector as a sheet", async ({ page, request }) => {
  const created = await createSession(request);
  await page.setViewportSize({ width: 659, height: 900 });
  await page.goto(`/?session=${created.session.id}&bootstrap=${created.bootstrapToken}`);
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${created.session.id}`, { headers: authorization() });
    return (await response.json() as { clients: string[] }).clients.some((client) => client.startsWith("web-"));
  }).toBe(true);
  await expect(page.locator(".pixel-canvas-shell")).toBeVisible();
  await expect(page.locator(".desktop-inspector")).toBeHidden();

  await page.getByRole("button", { name: "Open inspector" }).click();
  const sheet = page.locator(".mobile-inspector");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("tab", { name: "Edit" }).click();
  await expect(sheet.getByRole("heading", { name: "Palette" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Selection" })).toHaveCount(0);
});

test("deletes a recent local project only after confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Project menu" }).click();
  await page.getByRole("button", { name: "Save As" }).click();
  await page.getByRole("textbox", { name: "Save As project name" }).fill("Recent Delete Test");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("navigation", { name: "Project location" })).toContainText("Recent Delete Test");

  await page.getByRole("button", { name: "Project menu" }).click();
  await page.getByRole("button", { name: "Delete Untitled Project" }).click();
  const confirmation = page.getByRole("alert");
  await expect(confirmation).toContainText("Delete Untitled Project?");
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Untitled Project" })).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "Project menu" }).click();
  await expect(page.getByRole("button", { name: "Delete Untitled Project" })).toHaveCount(0);
});

async function createSession(request: APIRequestContext, options: { normalPixels?: number[] } = {}): Promise<{
  session: { id: string };
  bootstrapToken: string;
}> {
  const pixels = Array.from({ length: 8 * 6 }, () => 0);
  for (const index of [10, 11, 12, 13]) pixels[index] = 1;
  pixels[18] = 2;
  const document = createPixelDocument({
    id: "e2e-document",
    width: 8,
    height: 6,
    palette: ["#00000000", "#ff7a00ff", "#00dff7ff"],
    pixels
  });
  document.frames[0]!.id = "idle-1";
  document.frames[0]!.name = "Idle 1";
  document.layers[0]!.frames["idle-1"] = document.layers[0]!.frames["frame-1"]!;
  delete document.layers[0]!.frames["frame-1"];
  if (options.normalPixels) document.layers[0]!.normalFrames = { "idle-1": [...options.normalPixels] };
  const response = await request.post("/api/sessions", {
    headers: authorization(),
    data: { document, host: "codex" }
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ session: { id: string }; bootstrapToken: string }>;
}

async function sessionPixel(request: APIRequestContext, sessionId: string): Promise<{ revision: number; changed: number | undefined }> {
  const response = await request.get(`/api/sessions/${sessionId}`, { headers: authorization() });
  const session = await response.json() as {
    revision: number;
    document: { layers: Array<{ id: string; frames: Record<string, number[]> }> };
  };
  return {
    revision: session.revision,
    changed: session.document.layers.find((layer) => layer.id === "artwork")?.frames["idle-1"]?.[9]
  };
}

function authorization(client?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${daemonToken}`,
    ...(client ? { "X-Editable-Pixel-Client": client } : {})
  };
}
