import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPixelDocument, serializePixelDocument } from "@editable-pixel/document";
import { renderPng } from "@editable-pixel/renderer/node";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("editable-pixel CLI", () => {
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
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "editable-pixel-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

function context(output: string[], errors: string[]) {
  return {
    write: (text: string) => output.push(text),
    writeError: (text: string) => errors.push(text),
    openBrowser: async () => undefined
  };
}
