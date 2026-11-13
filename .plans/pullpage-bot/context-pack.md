# Context pack

BASE: main (HEAD 1af27df, branch pullpage-bot)
CHANGED: 28 files excluding package-lock.json, +1453/-0 (whole app is new)

## What this change does
New local Next.js app: drop 1-3 Pokemon cards, pick format (binder/toploader) and grid cell, run. Pipeline resizes, cleans each card via `agy`, composes a canvas, fills the background via `agy`, then has headless Claude (Haiku) build/export a Figma frame. Plan: `.plans/pullpage-bot/plan.md`.

## Files
- `src/lib/geometry.ts:11` — `cardRect(format, cell)`, `CANVAS`, `CARD`; every placement
- `src/lib/imaging.ts` — `toCard`:8, `padTo34`:11, `unpadFrom34`:23, `composeCanvas`:33, `jpegUnder`:44 (sharp)
- `src/lib/engines/types.ts:11` — `Engines` interface, `FigmaInput`, `CLEAN_PROMPT`/`FILL_PROMPT`
- `src/lib/engines/agy.ts` — `agyEnv`:11 (strips API keys), `runAgy`:16, `agyEngines`:66
- `src/lib/engines/figma.ts` — `buildFrameScript`:9, `extractJson`:32, `runClaude`:43, `publishToFigma`:87
- `src/lib/pipeline.ts` — `validateRun`:24, `runPipeline`:42, `runName`:22
- `src/lib/runs.ts` — in-memory run store (globalThis), single-run lock, `startRun`:27, `defaultEngines`:22
- `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts`, `src/app/api/runs/[id]/image/route.ts` — HTTP API
- `src/app/page.tsx` (152 lines), `layout.tsx`, `globals.css` — client screen, polls GET every 2 s
- `*.test.ts` beside each lib file; `README.md`, `.env.example`, `package.json`, `tsconfig.json`, `next.config.ts` — scaffold/docs

## API contracts
- `POST /api/runs` multipart `cards` File[], `cells` JSON int[], `formats` JSON string[], `name` -> 202 `{id}`; 400 `{errors}`; 409 busy. `src/app/api/runs/route.ts:7`
- `GET /api/runs/[id]` -> `Run` {id,status,steps[],results[{format,figmaUrl}]}; 404. Type at `src/lib/runs.ts:7`
- `GET /api/runs/[id]/image?format=` -> PNG from `output/<id>/*_<format>.png`; 404. `src/app/api/runs/[id]/image/route.ts:7`
- Engines boundary: `src/lib/engines/types.ts:11`
- External: `agy -p ... --mode accept-edits --sandbox`; `claude -p --model haiku` with Figma MCP tools (`figma.ts:43`)

## Test entry points
- All: `npm test` (vitest run); also `npm run lint` (tsc --noEmit), `npm run build`
- `src/lib/geometry.test.ts`, `src/lib/imaging.test.ts`, `src/lib/pipeline.test.ts`, `src/lib/engines/agy.test.ts`, `src/lib/engines/figma.test.ts` — `npx vitest run <file>`
- No tests for routes, `runs.ts` or `page.tsx`. No browser fixture (`.harness/` absent).

## Acceptance criteria (plan.md "Acceptance Criteria")
1. Binder cells sit at 751px and 1051px steps; toploader card sits 75px inside its 900x1200 cell (centre = 976,1276). geometry.test.ts
2. Any input image comes out 750x1050. imaging.test.ts
3. A background of 896x1200 comes out at the exact canvas size (2252x3152 or 2702x3602). imaging.test.ts
4. Final canvas is exactly 2252x3152 or 2702x3602. pipeline.test.ts with fakes
5. With fake engines, the original card is pixel-identical in its chosen cell in the final PNG. pipeline.test.ts
6. More than 3 cards, zero cards, or two cards on one cell are rejected before any engine call. pipeline.test.ts
7. `agy` is started without GEMINI_API_KEY or GOOGLE_API_KEY. agy.test.ts
8. Background sent to Figma is under 10MB. imaging.test.ts on jpegUnder
9. `agy` returning no image file stops the run and names the step; nothing is written to output/. pipeline.test.ts
10. `npm run build`, `npm run lint`, `npm test` pass.
- manual: Goldeen binder (frame `output_goldeen_binder` on page Automation, PNG 2252x3152) — needs real agy/Claude/Figma
- manual: Goldeen toploader (2702x3602, card at 976,1276)
- manual: two connecting cards (centre + right, binder, art continuous)
- manual: both formats in one run (one clean step per card)
- manual: print check of upscaled background

## Do not re-derive
- `agy` always returns 896x1200; size is never trusted, always `unpadFrom34` back. Toploader pads 1px, binder 56px per side.
- `agyEnv` must strip both API keys or agy bills the paid API.
- Figma upload max 10MB: background goes as JPEG (`jpegUnder`), cards as PNG; submit URLs are single-use, 10 min.
- Haiku is pinned (`--model haiku`); default model cost ~70x more.
- Run store is deliberately in-memory (`runs.ts:14` shortcut); a failed run keeps `.work/<id>/`, copies nothing to `output/`.
- Known risk (risks.md): Figma node IDs from Haiku are only checked for count/uniqueness.
- Out of scope: review gates, history, DB, 4K/Gemini API, zip/slices.

## Diff
Budget: only the geometry, engine-types, runs and API route files are inlined. Everything else: `git diff main...HEAD -- <path>` (src/lib/imaging.ts, pipeline.ts, engines/agy.ts, engines/figma.ts, all *.test.ts, src/app/page.tsx, layout/css, scaffold files). `package-lock.json` omitted.

```diff
--- /dev/null
+++ b/src/app/api/runs/[id]/image/route.ts
@@ -0,0 +1,21 @@
+import { readdir, readFile } from "node:fs/promises";
+import path from "node:path";
+import { NextResponse } from "next/server";
+import { FORMATS } from "@/lib/geometry";
+import { getRun } from "@/lib/runs";
+
+export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
+  const { id } = await ctx.params;
+  const format = new URL(req.url).searchParams.get("format") ?? "";
+  if (!getRun(id) || !FORMATS.includes(format as never)) return new NextResponse(null, { status: 404 });
+  try {
+    const dir = path.join(process.cwd(), "output", id);
+    const file = (await readdir(dir)).find((f) => f.endsWith(`_${format}.png`));
+    if (!file) return new NextResponse(null, { status: 404 });
+    return new NextResponse(new Uint8Array(await readFile(path.join(dir, file))), {
+      headers: { "content-type": "image/png", "content-disposition": `inline; filename="${file}"` },
+    });
+  } catch {
+    return new NextResponse(null, { status: 404 });
+  }
+}
--- /dev/null
+++ b/src/app/api/runs/[id]/route.ts
@@ -0,0 +1,7 @@
+import { NextResponse } from "next/server";
+import { getRun } from "@/lib/runs";
+
+export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
+  const run = getRun((await ctx.params).id);
+  return run ? NextResponse.json(run) : NextResponse.json({ error: "Unknown run." }, { status: 404 });
+}
--- /dev/null
+++ b/src/app/api/runs/route.ts
@@ -0,0 +1,31 @@
+import { NextResponse } from "next/server";
+import { runName, validateRun, type RunInput } from "@/lib/pipeline";
+import { defaultEngines, isBusy, startRun } from "@/lib/runs";
+
+export const runtime = "nodejs";
+
+export async function POST(req: Request) {
+  const form = await req.formData();
+  let input: RunInput;
+  try {
+    const cards = await Promise.all(
+      form.getAll("cards").map(async (f) => {
+        if (typeof f === "string") throw new Error("cards must be files");
+        return { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) };
+      }),
+    );
+    input = {
+      cards,
+      cells: JSON.parse(String(form.get("cells") ?? "[]")),
+      formats: JSON.parse(String(form.get("formats") ?? "[]")),
+      name: String(form.get("name") ?? ""),
+    };
+  } catch {
+    return NextResponse.json({ errors: ["Bad request."] }, { status: 400 });
+  }
+  const errors = validateRun(input);
+  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
+  if (isBusy()) return NextResponse.json({ errors: ["A run is already active."] }, { status: 409 });
+  const id = startRun({ ...input, name: runName(input) }, defaultEngines(process.env.FIGMA_FILE_KEY!));
+  return NextResponse.json({ id }, { status: 202 });
+}
--- /dev/null
+++ b/src/lib/engines/types.ts
@@ -0,0 +1,20 @@
+import type { Format } from "../geometry";
+
+export type FigmaInput = {
+  format: Format;
+  name: string;
+  bg: Buffer; // canvas-size PNG
+  originals: { cell: number; label: string; png: Buffer }[]; // 750x1050 PNGs
+  workDir: string;
+};
+
+export interface Engines {
+  clean(inPng: string, outPath: string): Promise<void>;
+  fill(inPng: string, outPath: string): Promise<void>;
+  figma(input: FigmaInput): Promise<{ url: string; pngPath: string }>;
+}
+
+export const CLEAN_PROMPT =
+  "Remove Text, Border, and everything aside from the art in the middle picture, and extend it but not, move the middle picture position at all. don't forget remove ALL TEXT ELEMENT (NUMERICAL,SYMBOL,ALPHABETICAL)";
+export const FILL_PROMPT =
+  "fill the white blank space with relevant arts extending from the center image background. Blend everything seamlessly so the whole canvas feels like one complete artwork, with no visible border between the center art and the new background. Do not move, resize or redraw the existing art.";
--- /dev/null
+++ b/src/lib/geometry.ts
@@ -0,0 +1,17 @@
+export type Format = "binder" | "toploader";
+
+export const FORMATS: Format[] = ["binder", "toploader"];
+export const CANVAS: Record<Format, { w: number; h: number }> = {
+  binder: { w: 2252, h: 3152 },
+  toploader: { w: 2702, h: 3602 },
+};
+export const CARD = { w: 750, h: 1050 };
+
+// cell 0..8, row-major
+export function cardRect(format: Format, cell: number) {
+  const col = cell % 3;
+  const row = Math.floor(cell / 3);
+  return format === "binder"
+    ? { x: col * 751, y: row * 1051, ...CARD }
+    : { x: col * 901 + 75, y: row * 1201 + 75, ...CARD };
+}
--- /dev/null
+++ b/src/lib/runs.ts
@@ -0,0 +1,44 @@
+import { agyEngines } from "./engines/agy";
+import { publishToFigma, runClaude } from "./engines/figma";
+import type { Engines } from "./engines/types";
+import type { Format } from "./geometry";
+import { runPipeline, type RunInput, type StepStatus } from "./pipeline";
+
+export type Run = {
+  id: string;
+  status: "running" | "done" | "failed";
+  steps: { label: string; status: StepStatus; error?: string }[];
+  results: { format: Format; figmaUrl: string }[];
+};
+
+// shortcut: in-memory, lost on restart; upgrade if runs must survive restarts.
+type Store = { map: Map<string, Run>; active?: string };
+const g = globalThis as unknown as { __runs?: Store };
+const store: Store = (g.__runs ??= { map: new Map() });
+
+export const getRun = (id: string) => store.map.get(id);
+export const isBusy = () => store.active !== undefined;
+
+export const defaultEngines = (fileKey: string): Engines => ({
+  ...agyEngines(),
+  figma: (i) => publishToFigma(i, { claude: (p) => runClaude(p), fetch, fileKey }),
+});
+
+export function startRun(input: RunInput, engines: Engines, root?: string) {
+  const run: Run = { id: crypto.randomUUID(), status: "running", steps: [], results: [] };
+  store.map.set(run.id, run);
+  store.active = run.id;
+  const onStep = (label: string, status: StepStatus, error?: string) => {
+    const s = run.steps.find((x) => x.label === label);
+    if (s) Object.assign(s, { status, error });
+    else run.steps.push({ label, status, error });
+  };
+  runPipeline(run.id, input, engines, onStep, root)
+    .then((r) => {
+      run.results = r;
+      run.status = "done";
+    })
+    .catch(() => (run.status = "failed"))
+    .finally(() => (store.active = undefined));
+  return run.id;
+}
```
