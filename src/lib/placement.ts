export const DEFAULT_CELLS = [4, 5, 3];
export type Dir = "up" | "down" | "left" | "right";

export function nextCell(cells: number[]): number {
  const d = DEFAULT_CELLS[cells.length];
  if (d !== undefined && !cells.includes(d)) return d;
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !cells.includes(i)) as number;
}

export function addAt(cells: number[], target?: number): number[] | null {
  if (cells.length >= 3) return null;
  if (target === undefined) return [...cells, nextCell(cells)];
  const at = cells.indexOf(target);
  if (at < 0) return [...cells, target];
  const next = [...cells];
  next[at] = nextCell(cells);
  return [...next, target];
}

export function moveTo(cells: number[], i: number, target: number): number[] {
  const next = [...cells];
  const other = cells.indexOf(target);
  if (other >= 0 && other !== i) next[other] = cells[i];
  next[i] = target;
  return next;
}

export function nudge(cells: number[], i: number, dir: Dir): number[] {
  const r = Math.floor(cells[i] / 3), c = cells[i] % 3;
  const nr = dir === "up" ? r - 1 : dir === "down" ? r + 1 : r;
  const nc = dir === "left" ? c - 1 : dir === "right" ? c + 1 : c;
  if (nr < 0 || nr > 2 || nc < 0 || nc > 2) return cells;
  return moveTo(cells, i, nr * 3 + nc);
}

export const removeAt = (cells: number[], i: number): number[] => cells.filter((_, j) => j !== i);
