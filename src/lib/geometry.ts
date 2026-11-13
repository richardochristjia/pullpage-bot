export type Format = "binder" | "toploader";

export const FORMATS: Format[] = ["binder", "toploader"];
export const CANVAS: Record<Format, { w: number; h: number }> = {
  binder: { w: 2252, h: 3152 },
  toploader: { w: 2702, h: 3602 },
};
export const CARD = { w: 750, h: 1050 };

// cell 0..8, row-major
export function cardRect(format: Format, cell: number) {
  const col = cell % 3;
  const row = Math.floor(cell / 3);
  return format === "binder"
    ? { x: col * 751, y: row * 1051, ...CARD }
    : { x: col * 901 + 75, y: row * 1201 + 75, ...CARD };
}
