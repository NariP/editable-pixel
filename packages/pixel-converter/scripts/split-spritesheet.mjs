import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { decodeImage, encodePng } from "@editable-pixel/image-codec";

const [, , inputPath, outputDirectory, columnCountArgument = "4", rowCountArgument = "1"] = process.argv;

if (!inputPath || !outputDirectory) {
  throw new Error("Usage: node split-spritesheet.mjs <input.png> <output-directory> [columns] [rows]");
}

const columnCount = Number(columnCountArgument);
const rowCount = Number(rowCountArgument);
if (!Number.isInteger(columnCount) || columnCount < 1 || !Number.isInteger(rowCount) || rowCount < 1) {
  throw new Error("Column and row counts must be positive integers.");
}

const input = resolve(inputPath);
const output = resolve(outputDirectory);
const sheet = await decodeImage(await readFile(input));
if (sheet.width % columnCount !== 0 || sheet.height % rowCount !== 0) {
  throw new Error(`The sprite-sheet dimensions must divide evenly into a ${columnCount} by ${rowCount} grid.`);
}

await mkdir(output, { recursive: true });
const frameWidth = sheet.width / columnCount;
const frameHeight = sheet.height / rowCount;
const frameCount = columnCount * rowCount;
const baseName = basename(input, extname(input));

for (let index = 0; index < frameCount; index += 1) {
  const frameNumber = String(index + 1).padStart(2, "0");
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  const frame = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  for (let y = 0; y < frameHeight; y += 1) {
    const source = ((row * frameHeight + y) * sheet.width + column * frameWidth) * 4;
    frame.set(sheet.data.subarray(source, source + frameWidth * 4), y * frameWidth * 4);
  }
  await writeFile(
    resolve(output, `${baseName}-${frameNumber}.png`),
    await encodePng({ data: frame, width: frameWidth, height: frameHeight })
  );
}

console.log(`Wrote ${frameCount} frames to ${output}`);
