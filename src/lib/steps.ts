// Client-safe: no node imports. The pipeline's emitted labels are pinned to planSteps by pipeline.test.ts.
import type { Format } from "./geometry";

export const PHASES = ["Prepare", "Clean cards", "Background", "Figma", "Save"] as const;
export type Phase = (typeof PHASES)[number];

export function planSteps(i: { cards: unknown[]; formats: Format[]; bgRef?: unknown }): string[] {
  return [
    "resize",
    ...(i.bgRef ? ["reference"] : []),
    ...i.cards.flatMap((_, k) => [`clean card ${k + 1}`, `clean card ${k + 1} check`]),
    ...i.formats.flatMap((f) => [`${f} canvas`, `${f} background`, `${f} check`, `${f} figma`]),
    "clean figma",
    "save",
  ];
}

export const phaseOf = (label: string): Phase =>
  label === "resize" || label === "reference"
    ? "Prepare"
    : label.startsWith("clean card")
      ? "Clean cards"
      : / (canvas|background|check)$/.test(label)
        ? "Background"
        : label.endsWith("figma")
          ? "Figma"
          : "Save";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// cards: display names in card order, e.g. ["Pikachu", "Eevee"].
export function stepLabel(label: string, cards: string[]): string {
  const m = /^clean card (\d+)( check)?$/.exec(label);
  if (m) return `${m[2] ? "Check" : "Clean"} ${cards[Number(m[1]) - 1] ?? `card ${m[1]}`}`;
  return cap(label);
}
