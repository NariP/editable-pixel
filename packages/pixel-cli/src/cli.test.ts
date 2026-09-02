import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPixelDocument, serializePixelDocument } from "@editable-pixel/document";
import { parsePixelProject } from "@editable-pixel/project";
import { renderPng } from "@editable-pixel/renderer/node";
import { startPixelServer, type RunningPixelServer } from "@editable-pixel/server";
import { PixelServerClient } from "@editable-pixel/server/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./cli.js";

const temporaryDirectories: string[] = [];
const servers: RunningPixelServer[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("editable-pixel CLI", () => {
  it("selects a diamond through the real server and shares History, Undo, and Redo", async () => {
    const { client, sessionId } = await connectedSession();
    const before = await client.getSession(sessionId);
    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "--json", "selection", "diamond", "--session", sessionId,
      "--center-x", "4", "--center-y", "2", "--width", "8"
    ], context(output, errors))).toBe(0);
    expect(errors).toEqual([]);
    const selection = {
      type: "mask", x: 1, y: 0, width: 6, height: 4, layerId: "artwork", frameId: "frame-1",
      indices: [3, 4, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 27, 28]
    };
    expect(JSON.parse(output[0]!)).toEqual({ sessionId, revision: 1, selection });
    expect((await client.getSession(sessionId)).document.layers).toEqual(before.document.layers);
    expect((await client.getHistory(sessionId)).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: "ai", client: "cli" })
    ]));
    expect(await runCli(["node", "editable-pixel", "undo", "--session", sessionId], context([], []))).toBe(0);
    expect((await client.getSelection(sessionId)).selection).toBeNull();
    expect(await runCli(["node", "editable-pixel", "redo", "--session", sessionId], context([], []))).toBe(0);
    expect((await client.getSelection(sessionId)).selection).toEqual(selection);

    const cleared: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "--json", "selection", "diamond", "--session", sessionId,
      "--center-x", "4", "--center-y", "2", "--width", "8", "--height", "4",
      "--layer", "artwork", "--frame", "frame-1", "--mode", "toggle"
    ], context(cleared, errors))).toBe(0);
    expect(JSON.parse(cleared[0]!)).toMatchObject({ sessionId, selection: null });
    expect((await client.getSelection(sessionId)).selection).toBeNull();
  });

  it("preserves the prior selection and revision after a rejected diamond", async () => {
    const { client, sessionId } = await connectedSession();
    await client.setSelectionCommand(sessionId, { type: "rect", x: 1, y: 1, width: 1, height: 1 });
    const before = await client.getSession(sessionId);
    const errors: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "selection", "diamond", "--session", sessionId,
      "--center-x", "99", "--center-y", "99", "--width", "8"
    ], context([], errors))).toBe(1);
    expect(JSON.parse(errors.at(-1)!)).toMatchObject({ error: { code: "SELECTION_INVALID" } });
    expect((await client.getSession(sessionId)).document).toEqual(before.document);
    expect(await runCli([
      "node", "editable-pixel", "selection", "diamond", "--session", sessionId,
      "--center-x", "4", "--center-y", "2", "--width", "8", "--frame", "missing-frame"
    ], context([], errors))).toBe(1);
    expect(errors.at(-1)).toContain("Unknown frame");
    expect((await client.getSession(sessionId)).document).toEqual(before.document);
  });

  it("dispatches grid controls to the same browser command API", async () => {
    const { client, sessionId } = await connectedSession();
    const execute = vi.spyOn(client, "executeWebCommand").mockResolvedValue({ sessionId, result: { ok: true } });
    const output: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "--json", "view", "set", "--session", sessionId, "--grid-mode", "isometric"
    ], context(output, []))).toBe(0);
    expect(execute).toHaveBeenLastCalledWith(sessionId, { type: "set_view", gridMode: "isometric" });
    expect(JSON.parse(output[0]!)).toEqual({ sessionId, result: { ok: true } });
    expect(await runCli([
      "node", "editable-pixel", "view", "set", "--session", sessionId, "--grid-mode", "square", "--grid", "hide"
    ], context([], []))).toBe(0);
    expect(execute).toHaveBeenLastCalledWith(sessionId, { type: "set_view", gridMode: "square", showGrid: false });
  });

  it("reports that grid controls need a connected browser", async () => {
    const { sessionId } = await connectedSession();
    const errors: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "view", "set", "--session", sessionId, "--grid-mode", "isometric"
    ], context([], errors))).toBe(1);
    expect(JSON.parse(errors.at(-1)!)).toMatchObject({ error: { code: "WEB_CLIENT_REQUIRED" } });
  });

  it("refuses an outdated daemon before sending a diamond that it cannot understand", async () => {
    const { client, sessionId } = await connectedSession();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const errors: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "selection", "diamond", "--session", sessionId,
      "--center-x", "4", "--center-y", "2", "--width", "8"
    ], context([], errors))).toBe(1);
    expect(JSON.parse(errors.at(-1)!)).toMatchObject({ error: { code: "SERVER_UPDATE_REQUIRED" } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0]![0])).toContain("/api/health");
    request.mockRestore();
    expect((await client.getSession(sessionId)).revision).toBe(0);
  });

  it.each([
    ["view", "set", "--session", "unused"],
    ["view", "set", "--session", "unused", "--grid-mode", "voxel"],
    ["view", "set", "--session", "unused", "--grid", "invalid"],
    ["selection", "diamond", "--session", "unused", "--center-x", "-1", "--center-y", "2", "--width", "8"],
    ["selection", "diamond", "--session", "unused", "--center-x", "4", "--center-y", "2", "--width", "1"],
    ["selection", "diamond", "--session", "unused", "--center-x", "4", "--center-y", "2", "--width", "8", "--mode", "invalid"]
  ])("rejects invalid arguments before connecting: %j", async (...args) => {
    const connect = vi.spyOn(PixelServerClient, "connect");
    const errors: string[] = [];
    expect(await runCli(["node", "editable-pixel", ...args], context([], errors))).toBe(1);
    expect(JSON.parse(errors.at(-1)!)).toMatchObject({ error: { code: "OPTION_INVALID" } });
    expect(connect).not.toHaveBeenCalled();
  });

  it("validates a document with machine-readable output", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "valid.pixel.json");
    await writeFile(path, serializePixelDocument(createPixelDocument({ width: 2, height: 2 })));
    const output: string[] = [];
    const errors: string[] = [];

    const code = await runCli(["node", "editable-pixel", "--json", "validate", path], context(output, errors));

    expect(code).toBe(0);
    expect(JSON.parse(output[0]!) as { valid: boolean }).toMatchObject({ valid: true });
    expect(errors).toEqual([]);
  });

  it("returns a stable error code for invalid documents", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "invalid.pixel.json");
    await writeFile(path, "{}");
    const errors: string[] = [];

    const code = await runCli(["node", "editable-pixel", "validate", path], context([], errors));

    expect(code).toBe(1);
    expect(JSON.parse(errors[0]!) as { error: { code: string } }).toMatchObject({ error: { code: "DOCUMENT_INVALID" } });
  });

  it("converts an image and refuses to overwrite the output", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "pixel.png");
    const output = join(directory, "pixel.pixel.json");
    await writeFile(input, await renderPng(createPixelDocument({ width: 1, height: 1, pixels: [1] })));

    const first = await runCli([
      "node", "editable-pixel", "convert", input, "--size", "1", "--output", output
    ], context([], []));
    const errors: string[] = [];
    const second = await runCli([
      "node", "editable-pixel", "convert", input, "--size", "1", "--output", output
    ], context([], errors));

    expect(first).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ format: "pixel-document" });
    expect(second).toBe(1);
    expect(errors[0]).toContain("OUTPUT_EXISTS");
  });

  it("converts to a custom rectangular canvas with a fixed palette", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "pixel.png");
    const output = join(directory, "pixel.pixel.json");
    await writeFile(input, await renderPng(createPixelDocument({
      width: 2,
      height: 2,
      palette: ["#00000000", "#ff0000ff", "#0000ffff"],
      pixels: [0, 1, 2, 0]
    })));

    const code = await runCli([
      "node", "editable-pixel", "convert", input,
      "--width", "3", "--height", "2",
      "--palette", "#00000000,#ff0000ff,#0000ffff",
      "--output", output
    ], context([], []));
    const document = JSON.parse(await readFile(output, "utf8")) as {
      canvas: { width: number; height: number };
      palette: string[];
    };

    expect(code).toBe(0);
    expect(document.canvas).toEqual({ width: 3, height: 2 });
    expect(document.palette).toEqual(["#00000000", "#ff0000ff", "#0000ffff"]);
  });

  it("shows a command-local example in help", async () => {
    const output: string[] = [];
    const code = await runCli(["node", "editable-pixel", "convert", "--help"], context(output, []));

    expect(code).toBe(0);
    expect(output.join("\n")).toContain("Example:");
    expect(output.join("\n")).toContain("--width 24 --height 32");
  });

  it("installs the bundled Codex or Claude skill without overwriting by default", async () => {
    const directory = await temporaryDirectory();
    const output: string[] = [];
    const first = await runCli([
      "node", "editable-pixel", "--json", "install-skill",
      "--host", "codex", "--target", directory
    ], context(output, []));
    const installed = JSON.parse(output[0]!) as { outputs: string[] };

    expect(first).toBe(0);
    await expect(access(join(installed.outputs[0]!, "SKILL.md"))).resolves.toBeUndefined();
    const errors: string[] = [];
    const second = await runCli([
      "node", "editable-pixel", "install-skill",
      "--host", "codex", "--target", directory
    ], context([], errors));
    expect(second).toBe(1);
    expect(errors.at(-1)).toContain("SKILL_EXISTS");
  });

  it("preflights an export bundle before writing any generated file", async () => {
    const directory = await temporaryDirectory();
    const documentPath = join(directory, "hero.pixel.json");
    const outputDirectory = join(directory, "export");
    await writeFile(documentPath, serializePixelDocument(createPixelDocument({ width: 2, height: 2 })));
    await mkdir(outputDirectory);
    await writeFile(join(outputDirectory, "sprite-sheet.json"), "existing");
    const errors: string[] = [];

    const code = await runCli([
      "node", "editable-pixel", "export", documentPath, "--output", outputDirectory
    ], context([], errors));

    expect(code).toBe(1);
    expect(errors.at(-1)).toContain("OUTPUT_EXISTS");
    await expect(access(join(outputDirectory, "document.pixel.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects image formats outside PNG, WebP, and JPEG", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "asset.gif");
    await writeFile(input, "not-a-supported-image");
    const errors: string[] = [];

    const code = await runCli([
      "node", "editable-pixel", "convert", input, "--output", join(directory, "asset.pixel.json")
    ], context([], errors));

    expect(code).toBe(1);
    expect(errors.at(-1)).toContain("INPUT_FORMAT_UNSUPPORTED");
  });

  it("creates and validates a Project, replaces and exports its canvas, and renders its Lit frame", async () => {
    const directory = await temporaryDirectory();
    const projectPath = join(directory, "robot.pixel-project.json");
    const documentPath = join(directory, "jump.pixel.json");
    const importedPath = join(directory, "robot-with-jump.pixel-project.json");
    const exportedPath = join(directory, "jump-export.pixel.json");
    const renderedPath = join(directory, "jump-lit.png");
    await writeFile(documentPath, serializePixelDocument(createPixelDocument({ width: 2, height: 2, pixels: [0, 1, 1, 0] })));

    expect(await runCli([
      "node", "editable-pixel", "project", "create", "Robot", "--size", "2", "--output", projectPath
    ], context([], []))).toBe(0);
    expect(await runCli([
      "node", "editable-pixel", "project", "import-document", projectPath, documentPath,
      "--output", importedPath
    ], context([], []))).toBe(0);
    const imported = parsePixelProject(await readFile(importedPath, "utf8"));
    expect(imported.document.canvas).toEqual({ width: 2, height: 2 });

    expect(await runCli([
      "node", "editable-pixel", "project", "export-document", importedPath,
      "--output", exportedPath
    ], context([], []))).toBe(0);
    expect(JSON.parse(await readFile(exportedPath, "utf8"))).toMatchObject({ format: "pixel-document" });

    expect(await runCli([
      "node", "editable-pixel", "render", importedPath,
      "--format", "lit", "--scale", "2", "--output", renderedPath
    ], context([], []))).toBe(0);
    await expect(access(renderedPath)).resolves.toBeUndefined();

    const validationOutput: string[] = [];
    expect(await runCli([
      "node", "editable-pixel", "--json", "validate", importedPath
    ], context(validationOutput, []))).toBe(0);
    expect(JSON.parse(validationOutput[0]!)).toMatchObject({ valid: true, format: "pixel-project" });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "editable-pixel-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function connectedSession() {
  const server = await startPixelServer();
  servers.push(server);
  const client = new PixelServerClient({
    pid: process.pid, port: server.port, daemonToken: server.daemonToken, startedAt: new Date().toISOString()
  });
  const created = await client.createSession({ document: createPixelDocument({ width: 8, height: 4 }) });
  vi.spyOn(PixelServerClient, "connect").mockResolvedValue(client);
  return { client, sessionId: created.session.id };
}

function context(output: string[], errors: string[]) {
  return {
    write: (text: string) => output.push(text),
    writeError: (text: string) => errors.push(text),
    openBrowser: async () => undefined
  };
}
