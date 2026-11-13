import type { Format } from "../geometry";

export type FigmaInput = {
  format: Format;
  name: string;
  bg: Buffer; // canvas-size PNG
  originals: { cell: number; label: string; png: Buffer }[]; // 750x1050 PNGs
  workDir: string;
};

export interface Engines {
  clean(inPng: string, outPath: string): Promise<void>;
  fill(inPng: string, outPath: string): Promise<void>;
  figma(input: FigmaInput): Promise<{ url: string; pngPath: string; frameId: string }>;
}

export const CLEAN_PROMPT =
  "Remove Text, Border, and everything aside from the art in the middle picture, and extend it but not, move the middle picture position at all. don't forget remove ALL TEXT ELEMENT (NUMERICAL,SYMBOL,ALPHABETICAL)";
export const FILL_PROMPT =
  "fill the white blank space with relevant arts extending from the center image background. Blend everything seamlessly so the whole canvas feels like one complete artwork, with no visible border between the center art and the new background. Do not move, resize or redraw the existing art.";
