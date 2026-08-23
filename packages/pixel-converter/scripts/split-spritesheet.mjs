import { mkdir } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import sharp from "sharp";

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
const metadata = await sharp(input).metadata();
if (!metadata.width || !metadata.height || metadata.width % columnCount !== 0 || metadata.height % rowCount !== 0) {
  throw new Error(`The sprite-sheet dimensions must divide evenly into a ${columnCount} by ${rowCount} grid.`);
}

await mkdir(output, { recursive: true });
const frameWidth = metadata.width / columnCount;
const frameHeight = metadata.height / rowCount;
const frameCount = columnCount * rowCount;
const baseName = basename(input, extname(input));

for (let index = 0; index < frameCount; index += 1) {
  const frameNumber = String(index + 1).padStart(2, "0");
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  await sharp(input)
    .extract({ left: column * frameWidth, top: row * frameHeight, width: frameWidth, height: frameHeight })
    .png()
    .toFile(resolve(output, `${baseName}-${frameNumber}.png`));
}

console.log(`Wrote ${frameCount} frames to ${output}`);
