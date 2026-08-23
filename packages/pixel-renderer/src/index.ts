import type { Layer, PixelDocument } from "@editable-pixel/document";

export interface RenderOptions {
  frameId?: string;
  layerIds?: string[];
}

export interface RenderedRgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function renderRgba(document: PixelDocument, options: RenderOptions = {}): RenderedRgba {
  const frameId = options.frameId ?? document.frames[0]!.id;
  const selectedLayers = options.layerIds
    ? document.layers.filter((layer) => options.layerIds!.includes(layer.id))
    : document.layers;
  const data = new Uint8ClampedArray(document.canvas.width * document.canvas.height * 4);

  for (const layer of selectedLayers) {
    if (!layer.visible || layer.opacity === 0) continue;
    compositeLayer(data, document, layer, frameId);
  }

  return { width: document.canvas.width, height: document.canvas.height, data };
}

function compositeLayer(
  target: Uint8ClampedArray,
  document: PixelDocument,
  layer: Layer,
  frameId: string
): void {
  const pixels = layer.frames[frameId];
  if (!pixels) throw new Error(`Layer ${layer.id} does not contain frame ${frameId}.`);

  for (let index = 0; index < pixels.length; index += 1) {
    const source = parseRgba(document.palette[pixels[index]!]!);
    const offset = index * 4;
    const sourceAlpha = (source[3] / 255) * layer.opacity;
    const targetAlpha = target[offset + 3]! / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha === 0) continue;

    for (let channel = 0; channel < 3; channel += 1) {
      const value =
        (source[channel]! * sourceAlpha + target[offset + channel]! * targetAlpha * (1 - sourceAlpha)) /
        outputAlpha;
      target[offset + channel] = Math.round(value);
    }
    target[offset + 3] = Math.round(outputAlpha * 255);
  }
}

export function parseRgba(color: string): [number, number, number, number] {
  if (!/^#[0-9a-fA-F]{8}$/.test(color)) throw new Error(`Invalid RGBA color: ${color}`);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    Number.parseInt(color.slice(7, 9), 16)
  ];
}

export function rgbaToImageData(rendered: RenderedRgba): ImageData {
  const data = new Uint8ClampedArray(rendered.data.length);
  data.set(rendered.data);
  return new ImageData(data, rendered.width, rendered.height);
}
