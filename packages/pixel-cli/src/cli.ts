#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { convertBatch, type ConvertOptions } from "@editable-pixel/converter";
import type { Patch } from "@editable-pixel/core";
import {
  parsePixelDocument,
  serializePixelDocument,
  validatePixelDocument,
  type PixelDocument
} from "@editable-pixel/document";
import {
  renderLayerPng,
  renderPng,
  renderPreviewPng,
  renderSpriteSheet
} from "@editable-pixel/renderer/node";
import { readRegistry, registryPath } from "@editable-pixel/server";
import { ClientError, PixelServerClient } from "@editable-pixel/server/client";
import { Command, CommanderError, Option } from "commander";
import open from "open";

interface CliContext {
  write: (text: string) => void;
  writeError: (text: string) => void;
  openBrowser: (url: string) => Promise<void>;
}

const defaultContext: CliContext = {
  write: (text) => process.stdout.write(`${text}\n`),
  writeError: (text) => process.stderr.write(`${text}\n`),
  openBrowser: async (url) => { await open(url); }
};

export function createProgram(context: CliContext = defaultContext): Command {
  const program = new Command()
    .name("editable-pixel")
    .description("Convert and edit AI-generated pixel assets as deterministic Pixel Documents.")
    .version("1.0.0")
    .option("--json", "print stable machine-readable JSON")
    .configureOutput({
      writeOut: (text) => context.write(text.trimEnd()),
      writeErr: (text) => context.writeError(text.trimEnd())
    })
    .exitOverride()
    .showHelpAfterError()
    .addHelpText("after", `
Examples:
  editable-pixel convert hero.png --size 32 --colors 16
  editable-pixel open hero.pixel.json
  editable-pixel selection get --session <session-id> --json
  editable-pixel patch preview --session <session-id> --patch change.json
  editable-pixel patch apply --session <session-id> --patch change.json`);

  program.command("convert")
    .description("Convert one or more PNG, WebP, or JPEG files into Pixel Documents.")
    .argument("<input...>", "input image paths")
    .addOption(new Option("--size <pixels>", "square logical canvas size").default("32"))
    .option("--width <pixels>", "custom logical canvas width")
    .option("--height <pixels>", "custom logical canvas height")
    .option("--colors <count>", "maximum palette colors", "16")
    .option("--palette <colors>", "fixed comma-separated #RRGGBB or #RRGGBBAA palette")
    .option("--alignment <mode>", "center or bottom-center", "bottom-center")
    .option("--content-scale <ratio>", "content occupancy from 0 to 1", "0.8")
    .option("--dithering <mode>", "none or floyd-steinberg", "none")
    .option("--background <mode>", "alpha, solid, or local-removal", "alpha")
    .option("--output <path>", "output file for one input or directory for several")
    .addHelpText("after", `
Example:
  editable-pixel convert hero.png --width 24 --height 32 --palette "#00000000,#26314fff,#f4d35eff" --output hero.pixel.json`)
    .action(async (inputs: string[], flags: {
      size: string;
      width?: string;
      height?: string;
      colors: string;
      palette?: string;
      alignment: string;
      contentScale: string;
      dithering: string;
      background: string;
      output?: string;
    }) => {
      const size = integer(flags.size, "size", 1, 4096);
      const palette = flags.palette ? paletteValue(flags.palette) : undefined;
      const options: ConvertOptions = {
        canvasWidth: flags.width ? integer(flags.width, "width", 1, 4096) : size,
        canvasHeight: flags.height ? integer(flags.height, "height", 1, 4096) : size,
        colorCount: palette?.length ?? integer(flags.colors, "colors", 1, 256),
        ...(palette ? { palette } : {}),
        alignment: enumValue(flags.alignment, ["center", "bottom-center"] as const, "alignment"),
        contentScale: numberValue(flags.contentScale, "content-scale", 0, 1, true),
        dithering: enumValue(flags.dithering, ["none", "floyd-steinberg"] as const, "dithering"),
        background: enumValue(flags.background, ["alpha", "solid", "local-removal"] as const, "background")
      };
      const sources = await Promise.all(inputs.map(async (path) => ({
        input: await readFile(path),
        metadata: { name: basename(path), mimeType: mimeFor(path) }
      })));
      const converted = await convertBatch(sources, options);
      const outputPaths = inputs.map((input) => conversionOutput(input, flags.output, inputs.length));
      await assertOutputPathsAvailable(outputPaths);
      const outputs: string[] = [];
      for (const [index, result] of converted.entries()) {
        const output = outputPaths[index]!;
        await writeExclusive(output, serializePixelDocument(result.document));
        outputs.push(resolve(output));
      }
      print(program, context, { outputs, count: outputs.length }, `Converted ${outputs.length} file(s):\n${outputs.map((path) => `- ${path}`).join("\n")}`);
    });

  program.command("open")
    .description("Open a Pixel Document in the local web editor and create an agent session.")
    .argument("<document>", "Pixel Document path")
    .option("--output-directory <path>", "allowed export directory")
    .option("--host <host>", "browser, codex, or claude", "browser")
    .option("--no-browser", "create the session without launching the browser")
    .addHelpText("after", `
Example:
  editable-pixel open hero.pixel.json --host codex --json`)
    .action(async (documentPath: string, flags: { outputDirectory?: string; host: string; browser: boolean }) => {
      parsePixelDocument(await readFile(documentPath, "utf8"));
      const host = enumValue(flags.host, ["browser", "codex", "claude"] as const, "host");
      const client = await ensureServer();
      const created = await client.createSession({
        documentPath: resolve(documentPath),
        outputDirectory: resolve(flags.outputDirectory ?? dirname(documentPath)),
        host
      });
      const launchUrl = client.browserUrl(created.session.id, created.bootstrapToken);
      if (flags.browser && host !== "codex") await context.openBrowser(launchUrl);
      const safeUrl = launchUrl.replace(/&bootstrap=.*/, "");
      print(program, context,
        {
          sessionId: created.session.id,
          url: safeUrl,
          revision: created.session.revision,
          ...(host === "codex" ? { launchUrl } : {})
        },
        `Opened ${created.session.documentName}\nSession: ${created.session.id}\nEditor: ${host === "codex" ? `${launchUrl}\nThis one-time URL must not be saved or logged.` : safeUrl}`
      );
    });

  program.command("validate")
    .description("Validate schema, references, palette indices, and canvas invariants.")
    .argument("<document>", "Pixel Document path")
    .addHelpText("after", `
Example:
  editable-pixel validate hero.pixel.json --json`)
    .action(async (path: string) => {
      const input = JSON.parse(await readFile(path, "utf8")) as unknown;
      const result = validatePixelDocument(input);
      if (!result.valid) throw new CliError("DOCUMENT_INVALID", result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
      print(program, context, result, `Valid Pixel Document: ${resolve(path)}`);
    });

  program.command("render")
    .description("Render a logical or nearest-neighbor preview PNG.")
    .argument("<document>", "Pixel Document path")
    .option("--output <path>", "PNG output path")
    .option("--scale <factor>", "nearest-neighbor preview scale", "1")
    .option("--frame <id>", "frame ID")
    .option("--layer <id>", "layer ID")
    .addHelpText("after", `
Example:
  editable-pixel render hero.pixel.json --scale 8 --output hero@8x.png`)
    .action(async (path: string, flags: { output?: string; scale: string; frame?: string; layer?: string }) => {
      const document = await loadDocument(path);
      const scale = integer(flags.scale, "scale", 1, 64);
      const output = resolve(flags.output ?? `${parse(path).name}${scale > 1 ? `-${scale}x` : ""}.png`);
      const png = flags.layer
        ? await renderLayerPng(document, flags.layer, flags.frame)
        : scale > 1
          ? await renderPreviewPng(document, scale, { frameId: flags.frame })
          : await renderPng(document, { frameId: flags.frame });
      await writeExclusive(output, png);
      print(program, context, { output, width: document.canvas.width * scale, height: document.canvas.height * scale }, `Rendered ${output}`);
    });

  program.command("export")
    .description("Export logical PNGs, layer/frame PNGs, preview, and sprite sheet bundle.")
    .argument("<document>", "Pixel Document path")
    .requiredOption("--output <directory>", "new or empty output directory")
    .addHelpText("after", `
Example:
  editable-pixel export hero.pixel.json --output hero-export`)
    .action(async (path: string, flags: { output: string }) => {
      const document = await loadDocument(path);
      const directory = resolve(flags.output);
      const names = [
        "document.pixel.json",
        "logical.png",
        "preview-8x.png",
        ...document.frames.map((frame) => `frame-${safe(frame.name)}.png`),
        ...document.layers.map((layer) => `layer-${safe(layer.name)}.png`),
        "sprite-sheet.png",
        "sprite-sheet.json"
      ];
      await assertOutputPathsAvailable(names.map((name) => join(directory, name)));
      await mkdir(directory, { recursive: true });
      const outputs: string[] = [];
      const add = async (name: string, data: string | Buffer) => {
        const output = join(directory, name);
        await writeExclusive(output, data);
        outputs.push(output);
      };
      await add("document.pixel.json", serializePixelDocument(document));
      await add("logical.png", await renderPng(document));
      await add("preview-8x.png", await renderPreviewPng(document, 8));
      for (const frame of document.frames) await add(`frame-${safe(frame.name)}.png`, await renderPng(document, { frameId: frame.id }));
      for (const layer of document.layers) await add(`layer-${safe(layer.name)}.png`, await renderLayerPng(document, layer.id));
      const sheet = await renderSpriteSheet(document);
      await add("sprite-sheet.png", sheet.png);
      await add("sprite-sheet.json", JSON.stringify(sheet.metadata, null, 2));
      print(program, context, { directory, outputs }, `Exported ${outputs.length} files to ${directory}`);
    });

  const session = program.command("session").description("Inspect and close local editor sessions.").addHelpText("after", `
Examples:
  editable-pixel session list
  editable-pixel session get <session-id>
  editable-pixel session close <session-id>`);
  session.command("list").description("List active sessions.").addHelpText("after", `
Example:
  editable-pixel session list --json`).action(async () => {
    const sessions = await (await PixelServerClient.connect()).listSessions();
    print(program, context, { sessions }, sessions.length ? sessions.map((item) => `${item.id}  rev ${item.revision}  ${item.host}  ${item.documentName}`).join("\n") : "No active sessions.");
  });
  session.command("get").description("Get one session and its document.").argument("<session-id>").addHelpText("after", `
Example:
  editable-pixel session get <session-id> --json`).action(async (id: string) => {
    const result = await (await PixelServerClient.connect()).getSession(id);
    print(program, context, result, `${result.id}  rev ${result.revision}  ${result.documentName}\nHost: ${result.host}\nClients: ${result.clients.join(", ") || "none"}`);
  });
  session.command("close").description("Close a session and revoke its tokens.").argument("<session-id>").addHelpText("after", `
Example:
  editable-pixel session close <session-id>`).action(async (id: string) => {
    const result = await (await PixelServerClient.connect()).closeSession(id);
    print(program, context, result, `Closed session ${id}.`);
  });

  const selection = program.command("selection").description("Read the current browser selection.").addHelpText("after", `
Example:
  editable-pixel selection get --session <session-id> --json`);
  selection.command("get").requiredOption("--session <id>").addHelpText("after", `
Example:
  editable-pixel selection get --session <session-id> --json`).action(async (flags: { session: string }) => {
    const result = await (await PixelServerClient.connect()).getSelection(flags.session);
    print(program, context, result, result.selection ? `Selection ${result.selection.type} ${result.selection.x},${result.selection.y} ${result.selection.width}×${result.selection.height}${result.selection.type === "mask" ? ` · ${result.selection.indices.length} pixels` : ""}` : "No active selection. Click [SELECT AREA] in the editor first.");
  });

  const patch = program.command("patch").description("Preview, explicitly apply, or reject an agent patch.").addHelpText("after", `
Examples:
  editable-pixel patch preview --session <session-id> --patch change.json
  editable-pixel patch apply --session <session-id> --patch <patch-id>`);
  patch.command("preview").requiredOption("--session <id>").requiredOption("--patch <file>").addHelpText("after", `
Example:
  editable-pixel patch preview --session <session-id> --patch change.json`).action(async (flags: { session: string; patch: string }) => {
    const value = await loadPatch(flags.patch);
    const result = await (await PixelServerClient.connect()).previewPatch(flags.session, value);
    print(program, context, result, `Patch ${value.id} is waiting for review in the editor.`);
  });
  patch.command("apply").requiredOption("--session <id>").requiredOption("--patch <file-or-id>").addHelpText("after", `
Example:
  editable-pixel patch apply --session <session-id> --patch <patch-id>`).action(async (flags: { session: string; patch: string }) => {
    const value = flags.patch.endsWith(".json") ? await loadPatch(flags.patch) : flags.patch;
    const result = await (await PixelServerClient.connect()).applyPatch(flags.session, value);
    print(program, context, result, `Applied patch. Session revision is now ${result.revision}.`);
  });
  patch.command("reject").requiredOption("--session <id>").requiredOption("--patch <patch-id>").addHelpText("after", `
Example:
  editable-pixel patch reject --session <session-id> --patch <patch-id>`).action(async (flags: { session: string; patch: string }) => {
    const result = await (await PixelServerClient.connect()).rejectPatch(flags.session, flags.patch);
    print(program, context, result, `Rejected patch ${flags.patch}.`);
  });

  program.command("undo").requiredOption("--session <id>").addHelpText("after", `
Example:
  editable-pixel undo --session <session-id>`).action(async (flags: { session: string }) => {
    const result = await (await PixelServerClient.connect()).undo(flags.session);
    print(program, context, result, `Undo complete. Revision ${result.revision}.`);
  });
  program.command("redo").requiredOption("--session <id>").addHelpText("after", `
Example:
  editable-pixel redo --session <session-id>`).action(async (flags: { session: string }) => {
    const result = await (await PixelServerClient.connect()).redo(flags.session);
    print(program, context, result, `Redo complete. Revision ${result.revision}.`);
  });

  return program;
}

export async function runCli(argv = process.argv, context: CliContext = defaultContext): Promise<number> {
  const program = createProgram(context);
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    let code = "UNEXPECTED_ERROR";
    if (error instanceof CliError) code = error.code;
    if (error instanceof ClientError) code = error.code;
    const message = error instanceof Error ? error.message : String(error);
    context.writeError(JSON.stringify({ error: { code, message } }));
    return 1;
  }
}

async function ensureServer(): Promise<PixelServerClient> {
  try {
    return await PixelServerClient.connect();
  } catch {
    // Coordinate concurrent `open` calls before spawning a shared daemon.
  }
  const lockPath = `${registryPath()}.start.lock`;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const lockDeadline = Date.now() + 12_000;
  let ownsLock = false;
  while (Date.now() < lockDeadline) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
      ownsLock = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockInfo = await stat(lockPath);
        if (Date.now() - lockInfo.mtimeMs > 10_000) {
          await unlink(lockPath);
          continue;
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      try {
        return await PixelServerClient.connect();
      } catch {
        // The process holding the startup lock is still publishing the daemon registry.
      }
    }
  }
  if (!ownsLock) throw new CliError("SERVER_START_FAILED", "Local editor server startup is already in progress but did not finish.");
  try {
    try {
      return await PixelServerClient.connect();
    } catch {
      // This process owns startup and must launch the daemon.
    }
    const runner = fileURLToPath(new URL("./server-runner.js", import.meta.url));
    const child = spawn(process.execPath, [runner], { detached: true, stdio: "ignore" });
    child.unref();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const registry = await readRegistry();
      if (!registry || registry.pid !== child.pid) continue;
      try {
        return await PixelServerClient.connect();
      } catch {
        // Wait for the child to bind and publish its health endpoint.
      }
    }
    throw new CliError("SERVER_START_FAILED", "Local editor server did not start within 8 seconds.");
  } finally {
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function loadDocument(path: string): Promise<PixelDocument> {
  return parsePixelDocument(await readFile(path, "utf8"));
}

async function loadPatch(path: string): Promise<Patch> {
  return JSON.parse(await readFile(path, "utf8")) as Patch;
}

async function writeExclusive(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  try {
    await writeFile(path, data, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliError("OUTPUT_EXISTS", `Refusing to overwrite existing file: ${resolve(path)}`);
    }
    throw error;
  }
}

function conversionOutput(input: string, output: string | undefined, inputCount: number): string {
  if (inputCount === 1) return output ?? join(dirname(input), `${parse(input).name}.pixel.json`);
  const directory = output ?? dirname(input);
  return join(directory, `${parse(input).name}.pixel.json`);
}

async function assertOutputPathsAvailable(paths: string[]): Promise<void> {
  const resolved = paths.map((path) => resolve(path));
  const collision = resolved.find((path, index) => resolved.indexOf(path) !== index);
  if (collision) throw new CliError("OUTPUT_COLLISION", `Multiple outputs resolve to the same file: ${collision}`);
  for (const path of resolved) {
    try {
      await access(path);
      throw new CliError("OUTPUT_EXISTS", `Refusing to overwrite existing file: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

function print(program: Command, context: CliContext, json: unknown, human: string): void {
  context.write(program.opts<{ json?: boolean }>().json ? JSON.stringify(json, null, 2) : human);
}

function integer(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliError("OPTION_INVALID", `--${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function numberValue(value: string, name: string, minimum: number, maximum: number, exclusiveMinimum = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (exclusiveMinimum ? parsed <= minimum : parsed < minimum) || parsed > maximum) {
    throw new CliError("OPTION_INVALID", `--${name} must be ${exclusiveMinimum ? "greater than" : "at least"} ${minimum} and at most ${maximum}.`);
  }
  return parsed;
}

function enumValue<const T extends readonly string[]>(value: string, allowed: T, name: string): T[number] {
  if (!allowed.includes(value)) throw new CliError("OPTION_INVALID", `--${name} must be one of: ${allowed.join(", ")}.`);
  return value as T[number];
}

function paletteValue(value: string): string[] {
  const palette = value.split(",").map((color) => color.trim()).filter(Boolean);
  if (palette.length < 1 || palette.length > 256 || palette.some((color) => !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color))) {
    throw new CliError("OPTION_INVALID", "--palette must contain 1 to 256 comma-separated #RRGGBB or #RRGGBBAA colors.");
  }
  if (new Set(palette.map((color) => color.toLowerCase())).size !== palette.length) {
    throw new CliError("OPTION_INVALID", "--palette colors must be unique.");
  }
  return palette;
}

function mimeFor(path: string): string {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.png$/i.test(path)) return "image/png";
  throw new CliError("INPUT_FORMAT_UNSUPPORTED", `Unsupported input format: ${path}. Use PNG, WebP, or JPEG.`);
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "pixel";
}

export class CliError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

if (await isMainModule()) {
  process.exitCode = await runCli();
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;
  try {
    return await realpath(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}
