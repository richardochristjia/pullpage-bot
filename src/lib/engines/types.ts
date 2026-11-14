import type { Format } from "../geometry";

export type FigmaInput = {
  format: Format;
  name: string;
  bg: Buffer; // canvas-size PNG
  originals: { cell: number; label: string; png: Buffer }[]; // 750x1050 PNGs
  workDir: string;
};

export type CleanFrameInput = { name: string; cleaned: Buffer[]; workDir: string }; // cleaned: 750x1050 PNGs

export type Verdict = { fail: boolean; flags: string[]; problems: string[]; skipped?: string };

export interface Engines {
  clean(inPng: string, outPath: string, avoid?: string[]): Promise<void>;
  fill(inPng: string, outPath: string, avoid?: string[]): Promise<void>;
  judge(kind: "clean" | "final", pngPaths: string[], cwd: string): Promise<Verdict>;
  cleanFrame(input: CleanFrameInput): Promise<{ frameId: string }>;
  figma(input: FigmaInput): Promise<{ url: string; pngPath: string; frameId: string }>;
}

export const CLEAN_PROMPT =
  "Create a new image from in.png using only the illustration inside the card's art window. Extend that illustration outward in every direction so it fills the whole canvas edge to edge, keeping the main subject at the same position and size. The extension must look like more of the same scene: keep the art window's exact color palette, brightness, lighting, weather and time of day, and continue its surfaces with the same objects, scale, perspective and art style across the window edges. Do not add rain, fog, night, buildings or any scenery that the art window does not already show. The trading card itself must not appear: no border, frame, boxes, icons, and no text, letters or numbers of any kind. The output is a clean, text-free artwork.";
export const FILL_PROMPT =
  "fill the white blank space with relevant arts extending from the center image background. Blend everything seamlessly so the whole canvas feels like one complete artwork, with no visible border between the center art and the new background. Do not move, resize or redraw the existing art. The new background must contain no text, letters, numbers, symbols, logos or watermarks.";
