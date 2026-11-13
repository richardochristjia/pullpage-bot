import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { FORMATS, type Format } from "./geometry";
import { composeCanvas, toCard } from "./imaging";
import type { Engines } from "./engines/types";

export type RunInput = {
  cards: { name: string; type: string; buf: Buffer }[];
  cells: number[];
  formats: Format[];
  name?: string;
  fileKey?: string;
};
export type StepStatus = "pending" | "running" | "done" | "failed";
export type OnStep = (label: string, status: StepStatus, error?: string) => void;

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

export const slugify = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export const runName = (i: RunInput) => slugify(i.name || i.cards[0]?.name || "");

export const displayName = (i: RunInput) =>
  (i.name || i.cards[0]?.name || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || runName(i);

export function validateRun(i: RunInput, fileKey = process.env.FIGMA_FILE_KEY): string[] {
  const e: string[] = [];
  if (i.cards.length < 1 || i.cards.length > 3) e.push("Pick 1 to 3 cards.");
  for (const c of i.cards) {
    if (!TYPES.includes(c.type)) e.push(`${c.name}: must be png, jpeg or webp.`);
    if (c.buf.length > MAX_BYTES) e.push(`${c.name}: larger than 25MB.`);
  }
  if (i.cells.length !== i.cards.length || !i.cells.every((c) => Number.isInteger(c) && c >= 0 && c <= 8)) {
    e.push("Each card needs a cell from 0 to 8.");
  } else if (new Set(i.cells).size !== i.cells.length) e.push("Two cards share a cell.");
  if (!i.formats.length || new Set(i.formats).size !== i.formats.length || !i.formats.every((f) => FORMATS.includes(f))) {
    e.push("Pick binder, toploader or both.");
  }
  if (!runName(i)) e.push("Name must be letters, digits, _ or -.");
  if (!fileKey) e.push("FIGMA_FILE_KEY is not set.");
  return e;
}

export async function runPipeline(
  id: string,
  input: RunInput,
  engines: Engines,
  onStep: OnStep,
  root = process.cwd(),
) {
  const name = runName(input);
  const work = path.join(root, ".work", id);
  await mkdir(work, { recursive: true });
  const step = async <T>(label: string, fn: () => Promise<T>) => {
    onStep(label, "running");
    try {
      const r = await fn();
      onStep(label, "done");
      return r;
    } catch (e) {
      const msg = `${label}: ${(e as Error).message}`;
      onStep(label, "failed", msg);
      throw new Error(msg);
    }
  };

  const originals = await step("resize", () => Promise.all(input.cards.map((c) => toCard(c.buf))));
  const cleaned: Buffer[] = [];
  for (const [k, orig] of originals.entries()) {
    cleaned.push(
      await step(`clean card ${k + 1}`, async () => {
        const inp = path.join(work, `card${k}.png`);
        const out = path.join(work, `card${k}.clean.png`);
        await writeFile(inp, orig);
        await engines.clean(inp, out);
        return readFile(out);
      }),
    );
  }

  const results: { format: Format; figmaUrl: string; pngPath: string; frameId: string }[] = [];
  for (const format of input.formats) {
    const canvas = await step(`${format} canvas`, () =>
      composeCanvas(format, cleaned.map((png, k) => ({ cell: input.cells[k], png }))),
    );
    const bg = await step(`${format} background`, async () => {
      const inp = path.join(work, `${format}.canvas.png`);
      const out = path.join(work, `${format}.bg.png`);
      await writeFile(inp, canvas);
      await engines.fill(inp, out);
      return readFile(out);
    });
    const r = await step(`${format} figma`, () =>
      engines.figma({
        format,
        name,
        bg,
        originals: originals.map((png, k) => ({ cell: input.cells[k], label: `card${k + 1}`, png })),
        workDir: work,
      }),
    );
    results.push({ format, figmaUrl: r.url, pngPath: r.pngPath, frameId: r.frameId });
  }

  const clean = await step("clean figma", () => engines.cleanFrame({ name, cleaned, workDir: work }));

  // Only a fully successful run writes to output/.
  await step("save", async () => {
    const dir = path.join(root, "output", id);
    await mkdir(dir, { recursive: true });
    for (const r of results) await cp(r.pngPath, path.join(dir, `output_${name}_${r.format}.png`));
    const meta = {
      id,
      name: displayName(input),
      slug: name,
      cells: input.cells,
      fileKey: input.fileKey,
      cleanFrameId: clean.frameId,
      createdAt: new Date().toISOString(),
      formats: Object.fromEntries(results.map((r) => [r.format, { frameId: r.frameId }])),
    };
    await writeFile(path.join(dir, "run.json"), JSON.stringify(meta, null, 2));
  });
  return results.map((r) => ({ format: r.format, figmaUrl: r.figmaUrl }));
}
