import { createHash } from "node:crypto";
import { cp, mkdir, writeFile, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { FORMATS, type Format } from "./geometry";
import { cleanPair, composeCanvas, finalPreviews, toCard } from "./imaging";
import sharp from "sharp";
import { CLEAN_PROMPT, type Engines, type FillExtra, type Verdict } from "./engines/types";

export type RunInput = {
  cards: { name: string; type: string; buf: Buffer }[];
  cells: number[];
  formats: Format[];
  name?: string;
  fileKey?: string;
  bgPrompt?: string;
  bgRef?: { name: string; type: string; buf: Buffer };
};
export type StepStatus = "pending" | "running" | "done" | "failed";
export type OnStep = (label: string, status: StepStatus, error?: string, image?: string) => void; // error doubles as a note on done steps; image names a .work file
export { planSteps } from "./steps";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

export const slugify = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Identifies a card's clean: the uploaded bytes plus the prompt, so a new prompt invalidates old cleans.
export const cardKey = (buf: Buffer, prompt = CLEAN_PROMPT) =>
  createHash("sha256").update(buf).update(prompt).digest("hex").slice(0, 16);

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
  if (i.bgRef) {
    if (!TYPES.includes(i.bgRef.type)) e.push("Reference image must be png, jpeg or webp.");
    if (i.bgRef.buf.length > MAX_BYTES) e.push("Reference image is larger than 25MB.");
  }
  if (i.bgPrompt && i.bgPrompt.length > 1000) e.push("Background prompt is longer than 1000 characters.");
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
  const step = async <T>(label: string, fn: () => Promise<T>, image?: string) => {
    onStep(label, "running");
    try {
      const r = await fn();
      onStep(label, "done", undefined, image);
      return r;
    } catch (e) {
      const msg = `${label}: ${(e as Error).message}`;
      onStep(label, "failed", msg);
      throw new Error(msg);
    }
  };

  // Judge an attempt; on a fail regenerate once with the judge's problems and keep the one with fewer flags (tie: the retry).
  const check = async (
    label: string,
    first: Buffer,
    judgeIt: (buf: Buffer, tag: string) => Promise<Verdict>,
    retry: (avoid: string[]) => Promise<Buffer>,
    files: [string, string],
  ) => {
    onStep(label, "running");
    const note = (v: Verdict, retried: boolean) =>
      v.skipped ? `skipped: ${v.skipped}` : v.fail ? `needs review: ${v.flags.join(", ")}` : retried ? "pass after retry" : "pass";
    const ok = (v: Verdict) => !v.fail && !v.skipped; // an unchecked result is not a pass
    const v1 = await judgeIt(first, "");
    if (!v1.fail) {
      onStep(label, "done", note(v1, false), files[0]);
      return { buf: first, passed: ok(v1) };
    }
    let second: Buffer;
    try {
      second = await retry(v1.problems);
    } catch (e) {
      onStep(label, "done", `${note(v1, false)} (retry failed: ${(e as Error).message})`, files[0]);
      return { buf: first, passed: false };
    }
    const v2 = await judgeIt(second, "2");
    const keepRetry = v2.flags.length <= v1.flags.length;
    onStep(label, "done", note(keepRetry ? v2 : v1, true), files[keepRetry ? 1 : 0]);
    return { buf: keepRetry ? second : first, passed: ok(keepRetry ? v2 : v1) };
  };

  const originals = await step("resize", () => Promise.all(input.cards.map((c) => toCard(c.buf))));
  // Convert the reference before any agy call so a corrupt one fails fast as its own step.
  const bgRef = input.bgRef;
  const ref = bgRef ? path.join(work, "bg-ref.png") : undefined;
  if (bgRef && ref) await step("reference", async () => writeFile(ref, await sharp(bgRef.buf).png().toBuffer()));
  const extra: FillExtra | undefined = input.bgRef || input.bgPrompt ? { prompt: input.bgPrompt || undefined, ref } : undefined;
  const cleaned: Buffer[] = [];
  const keys = input.cards.map((c) => cardKey(c.buf));
  const keyed: (string | undefined)[] = []; // keys of cleans that passed or were reused
  const cacheDir = path.join(root, ".cache", "clean");
  const cachePut = (k: number, buf: Buffer) =>
    // tmp + rename so a crash mid-write never leaves a half PNG under the key
    mkdir(cacheDir, { recursive: true })
      .then(async () => {
        const tmp = path.join(cacheDir, `${keys[k]}.${process.pid}.tmp`);
        await writeFile(tmp, buf);
        await rename(tmp, path.join(cacheDir, `${keys[k]}.png`));
      })
      .catch(() => {});
  const reused = new Map<number, { buf: Buffer; from: string }>();
  for (const [k, key] of keys.entries()) {
    const buf = await readFile(path.join(cacheDir, `${key}.png`)).catch(() => undefined);
    if (buf) reused.set(k, { buf, from: "cache" });
  }
  const missing = [...new Set(keys.filter((_, k) => !reused.has(k)))];
  if (missing.length) {
    // A failed lookup is a miss, never a run failure.
    const found = await engines.findCleans(missing).catch((): Record<string, Buffer> => ({}));
    for (const [k, key] of keys.entries()) {
      if (reused.has(k) || !found[key]) continue;
      reused.set(k, { buf: found[key], from: "Figma" });
      await cachePut(k, found[key]);
    }
  }
  for (const [k, orig] of originals.entries()) {
    const hit = reused.get(k);
    if (hit) {
      const label = `clean card ${k + 1}`;
      const img = `card${k}.clean.png`;
      onStep(label, "running");
      await writeFile(path.join(work, img), hit.buf);
      onStep(label, "done", `reused from ${hit.from}`, img);
      onStep(`${label} check`, "running");
      onStep(`${label} check`, "done", "skipped: reused");
      cleaned.push(hit.buf);
      keyed.push(keys[k]);
      continue;
    }
    const inp = path.join(work, `card${k}.png`);
    const out = path.join(work, `card${k}.clean.png`);
    const first = await step(`clean card ${k + 1}`, async () => {
      await writeFile(inp, orig);
      await engines.clean(inp, out);
      return readFile(out);
    }, `card${k}.clean.png`);
    const res = await check(
        `clean card ${k + 1} check`,
        first,
        async (buf, tag) => {
          const pair = path.join(work, `card${k}.pair${tag}.png`);
          await writeFile(pair, await cleanPair(orig, buf));
          return engines.judge("clean", [pair], work);
        },
        async (avoid) => {
          const out2 = path.join(work, `card${k}.clean2.png`);
          await engines.clean(inp, out2, avoid);
          return readFile(out2);
        },
        [`card${k}.clean.png`, `card${k}.clean2.png`],
      );
    cleaned.push(res.buf);
    keyed.push(res.passed ? keys[k] : undefined);
    if (res.passed) await cachePut(k, res.buf);
  }

  const results: { format: Format; figmaUrl: string; pngPath: string; frameId: string }[] = [];
  for (const format of input.formats) {
    const canvas = await step(
      `${format} canvas`,
      () => composeCanvas(format, cleaned.map((png, k) => ({ cell: input.cells[k], png }))),
      `${format}.canvas.png`,
    );
    const inp = path.join(work, `${format}.canvas.png`);
    const firstBg = await step(`${format} background`, async () => {
      await writeFile(inp, canvas);
      const out = path.join(work, `${format}.bg.png`);
      await engines.fill(inp, out, undefined, extra);
      return readFile(out);
    }, `${format}.bg.png`);
    const { buf: bg } = await check(
      `${format} check`,
      firstBg,
      async (buf, tag) => {
        const { full, raw, crops } = await finalPreviews(format, buf, originals.map((png, k) => ({ cell: input.cells[k], png })));
        const files = [`${format}.full${tag}.png`, `${format}.raw${tag}.png`, ...crops.map((_, i) => `${format}.crop${tag}${i + 1}.png`)].map((f) => path.join(work, f));
        await Promise.all([full, raw, ...crops].map((b, i) => writeFile(files[i], b)));
        return engines.judge("final", files, work);
      },
      async (avoid) => {
        const out2 = path.join(work, `${format}.bg2.png`);
        await engines.fill(inp, out2, avoid, extra);
        return readFile(out2);
      },
      [`${format}.bg.png`, `${format}.bg2.png`],
    );
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

  const clean = await step("clean figma", () => engines.cleanFrame({ name, cleaned, keys: keyed, workDir: work }));

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
