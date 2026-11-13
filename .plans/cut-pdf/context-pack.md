# Context pack

BASE: pullpage-bot (branch cut-pdf)
CHANGED: 29 files, +933/-25 (source: src/, package.json, README.md, .agents/RECORD.md; rest is .plans/)

## What this change does
Adds "Approve & make PDF" per format: re-exports the Figma frame (`exportFrame`), cuts it with fixed grid numbers via `sharp.extract` (no AI), writes one lossless 300 dpi PDF per format (pdf-lib 1.17.1). Run metadata is persisted to `output/<runId>/run.json` so approval survives restarts. Spec: `.plans/cut-pdf/plan.md`.

## Files
- `src/lib/cut.ts` (new) - `pieceRects`, `cutPieces`, `buildPdf`, `pdfFileName`
- `src/lib/approve.ts` (new) - `isRunId`, `readMeta`, `listRuns`, `approveFormat`, per-run/format lock
- `src/lib/engines/figma.ts` - `exportFrame()` extracted; `publishToFigma` returns `frameId`
- `src/lib/engines/types.ts` - `Engines.figma` returns `{url,pngPath,frameId}`
- `src/lib/pipeline.ts` - `displayName()`, `save` step writes `run.json`
- `src/lib/runs.ts` - `defaultFigmaDeps(fileKey)`
- `src/app/api/runs/route.ts` - stops overwriting name with slug; adds GET list
- `src/app/api/runs/[id]/approve/route.ts` (new) - `POST ?format=`
- `src/app/api/runs/[id]/pdf/route.ts` (new) - `GET ?format=`
- `src/app/api/runs/[id]/image/route.ts` - gate on `isRunId`+`run.json` instead of `getRun`
- `src/app/page.tsx` - Approve component + Past runs list (diff NOT inlined, +74 lines; open the file)
- `src/lib/{cut,approve,pipeline}.test.ts`, `src/lib/engines/figma.test.ts` - tests (diffs NOT inlined)
- `package.json`, `README.md`, `.agents/RECORD.md` - dep, docs, record

## API contracts
- `POST /api/runs/{id}/approve?format=binder|toploader` -> 200 `{pdf}` | 404 | 409 | 500 `{error}`; logic in `src/lib/approve.ts` (`approveFormat`)
- `GET /api/runs/{id}/pdf?format=` -> application/pdf attachment, 404 if absent
- `GET /api/runs` -> `[{id,name,createdAt,formats:[{format,approved}]}]`
- `Engines.figma` type declared in `src/lib/engines/types.ts`
- `run.json`: `{id,name,slug,cells,fileKey,createdAt,formats:{<fmt>:{frameId,approvedAt?}}}`

## Test entry points
- `npx vitest run src/lib/cut.test.ts src/lib/approve.test.ts src/lib/pipeline.test.ts src/lib/engines/figma.test.ts`
- Full gate: `npm test && npm run lint && npm run build` (lint = `tsc --noEmit`)

## Acceptance criteria (from plan.md)
1. Binder cells [4] -> 8 pieces 750x1050 (cells 0,1,2,3,5,6,7,8); cards [3,4,5] -> 6 pieces.
2. Toploader -> always 9 pieces 900x1200, card cells included.
3. Piece raw pixels byte-equal to `sharp.extract` at grid rect; no resampling.
4. PDF pages row-major; binder 180x252 pt, toploader 216x288 pt; embedded image byte-equal to piece raw RGB.
5. Export not exactly canvas size -> approval fails with clear error, no PDF written.
6. Approve 404 for non-UUID id (`../x`), missing run.json, bad format; concurrent same run+format -> 409.
7. Successful run writes `run.json` with name, slug, cells, fileKey, frameId per format.
8. `npm test`, `npm run lint`, `npm run build` pass.
- manual: Goldeen binder, edit Figma layer, Approve; PDF has 8 pages at 2.5x3.5 in and shows edit (needs real Figma).
- manual: compare to `~/Downloads/Goldeen AR.pdf` with `pdfimages -list/-png` (needs real Figma).
- manual: restart `npm run dev`; run appears under Past runs and can be approved.
- manual: toploader run gives 9-page 3x4 in PDF, 75px card border intact.

## Do not re-derive
- Cut constants match `cardRect`/`CANVAS` in `src/lib/geometry.ts` (unchanged): binder step 751/1051, toploader 901/1201; gaps between cells are intentionally uncut.
- Binder skips cells holding a card (`meta.cells`); toploader keeps all 9.
- Re-export (not saved PNG) is deliberate so manual Figma edits are included; original PNG kept, re-export saved as `.approved.png`.
- Path-traversal guard moved from `getRun` to `isRunId` in the image route.
- Repo has no remote and no `.harness/` fixture; PR/browser walkthrough not possible. Runs predating `run.json` are not approvable by design.
- Base is `pullpage-bot`, not `main`.

## Diff (src non-test, excluding page.tsx, lockfile; tests and page.tsx omitted for budget)
```diff
diff --git a/package.json b/package.json
index 8f590fb..ccd32a5 100644
--- a/package.json
+++ b/package.json
@@ -11,6 +11,7 @@
   },
   "dependencies": {
     "next": "16.2.11",
+    "pdf-lib": "1.17.1",
     "react": "19.2.4",
     "react-dom": "19.2.4",
     "sharp": "^0.34.0"
diff --git a/src/app/api/runs/[id]/approve/route.ts b/src/app/api/runs/[id]/approve/route.ts
new file mode 100644
index 0000000..ea9d3ae
--- /dev/null
+++ b/src/app/api/runs/[id]/approve/route.ts
@@ -0,0 +1,14 @@
+import { NextResponse } from "next/server";
+import { approveFormat } from "@/lib/approve";
+import { exportFrame } from "@/lib/engines/figma";
+import { defaultFigmaDeps } from "@/lib/runs";
+
+export const runtime = "nodejs";
+
+export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
+  const { id } = await ctx.params;
+  const format = new URL(req.url).searchParams.get("format") ?? "";
+  const r = await approveFormat(process.cwd(), id, format, (k, fid, f) => exportFrame(defaultFigmaDeps(k), fid, f));
+  const { status, ...body } = r;
+  return NextResponse.json(body, { status });
+}
diff --git a/src/app/api/runs/[id]/image/route.ts b/src/app/api/runs/[id]/image/route.ts
index 383a70b..5eaca9f 100644
--- a/src/app/api/runs/[id]/image/route.ts
+++ b/src/app/api/runs/[id]/image/route.ts
@@ -1,13 +1,13 @@
 import { readdir, readFile } from "node:fs/promises";
 import path from "node:path";
 import { NextResponse } from "next/server";
+import { isRunId, readMeta } from "@/lib/approve";
 import { FORMATS } from "@/lib/geometry";
-import { getRun } from "@/lib/runs";
 
 export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
   const { id } = await ctx.params;
   const format = new URL(req.url).searchParams.get("format") ?? "";
-  if (!getRun(id) || !FORMATS.includes(format as never)) return new NextResponse(null, { status: 404 });
+  if (!isRunId(id) || !(await readMeta(process.cwd(), id)) || !FORMATS.includes(format as never)) return new NextResponse(null, { status: 404 });
   try {
     const dir = path.join(process.cwd(), "output", id);
     const file = (await readdir(dir)).find((f) => f.endsWith(`_${format}.png`));
diff --git a/src/app/api/runs/[id]/pdf/route.ts b/src/app/api/runs/[id]/pdf/route.ts
new file mode 100644
index 0000000..b80fd82
--- /dev/null
+++ b/src/app/api/runs/[id]/pdf/route.ts
@@ -0,0 +1,23 @@
+import { readFile } from "node:fs/promises";
+import path from "node:path";
+import { NextResponse } from "next/server";
+import { isFormat, isRunId, readMeta } from "@/lib/approve";
+import { pdfFileName } from "@/lib/cut";
+
+export const runtime = "nodejs";
+
+export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
+  const { id } = await ctx.params;
+  const format = new URL(req.url).searchParams.get("format") ?? "";
+  const meta = isRunId(id) && isFormat(format) ? await readMeta(process.cwd(), id) : null;
+  if (!meta) return new NextResponse(null, { status: 404 });
+  const file = pdfFileName(meta.name, format as never);
+  try {
+    const pdf = await readFile(path.join(process.cwd(), "output", id, file));
+    return new NextResponse(new Uint8Array(pdf), {
+      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}` },
+    });
+  } catch {
+    return new NextResponse(null, { status: 404 });
+  }
+}
diff --git a/src/app/api/runs/route.ts b/src/app/api/runs/route.ts
index 0e22ef9..9e2d631 100644
--- a/src/app/api/runs/route.ts
+++ b/src/app/api/runs/route.ts
@@ -1,9 +1,14 @@
 import { NextResponse } from "next/server";
-import { runName, validateRun, type RunInput } from "@/lib/pipeline";
+import { listRuns } from "@/lib/approve";
+import { validateRun, type RunInput } from "@/lib/pipeline";
 import { defaultEngines, isBusy, startRun } from "@/lib/runs";
 
 export const runtime = "nodejs";
 
+export async function GET() {
+  return NextResponse.json(await listRuns(process.cwd()));
+}
+
 export async function POST(req: Request) {
   const form = await req.formData();
   let input: RunInput;
@@ -19,6 +24,7 @@ export async function POST(req: Request) {
       cells: JSON.parse(String(form.get("cells") ?? "[]")),
       formats: JSON.parse(String(form.get("formats") ?? "[]")),
       name: String(form.get("name") ?? ""),
+      fileKey: process.env.FIGMA_FILE_KEY,
     };
   } catch {
     return NextResponse.json({ errors: ["Bad request."] }, { status: 400 });
@@ -26,6 +32,6 @@ export async function POST(req: Request) {
   const errors = validateRun(input);
   if (errors.length) return NextResponse.json({ errors }, { status: 400 });
   if (isBusy()) return NextResponse.json({ errors: ["A run is already active."] }, { status: 409 });
-  const id = startRun({ ...input, name: runName(input) }, defaultEngines(process.env.FIGMA_FILE_KEY!));
+  const id = startRun(input, defaultEngines(process.env.FIGMA_FILE_KEY!));
   return NextResponse.json({ id }, { status: 202 });
 }
diff --git a/src/lib/approve.ts b/src/lib/approve.ts
new file mode 100644
index 0000000..b785aa6
--- /dev/null
+++ b/src/lib/approve.ts
@@ -0,0 +1,75 @@
+import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
+import path from "node:path";
+import { buildPdf, cutPieces, pdfFileName } from "./cut";
+import { FORMATS, type Format } from "./geometry";
+
+export type RunMeta = {
+  id: string;
+  name: string;
+  slug: string;
+  cells: number[];
+  fileKey?: string;
+  createdAt: string;
+  formats: Partial<Record<Format, { frameId: string; approvedAt?: string }>>;
+};
+export type Exporter = (fileKey: string, frameId: string, format: Format) => Promise<Buffer>;
+export type ApproveResult = { status: 200; pdf: string } | { status: 404 | 409 | 500; error: string };
+
+export const isRunId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
+export const isFormat = (s: string): s is Format => FORMATS.includes(s as Format);
+
+export async function readMeta(root: string, id: string): Promise<RunMeta | null> {
+  if (!isRunId(id)) return null;
+  try {
+    return JSON.parse(await readFile(path.join(root, "output", id, "run.json"), "utf8"));
+  } catch {
+    return null;
+  }
+}
+
+const g = globalThis as unknown as { __approving?: Set<string> };
+const locks = (g.__approving ??= new Set());
+
+export async function approveFormat(root: string, id: string, format: string, exporter: Exporter): Promise<ApproveResult> {
+  const meta = isFormat(format) ? await readMeta(root, id) : null;
+  const entry = meta?.formats[format as Format];
+  if (!meta || !entry) return { status: 404, error: "Run not found." };
+  const f = format as Format;
+  const key = `${id}:${f}`;
+  if (locks.has(key)) return { status: 409, error: "Already approving." };
+  locks.add(key);
+  try {
+    if (!meta.fileKey) throw new Error("run.json has no fileKey");
+    const png = await exporter(meta.fileKey, entry.frameId, f);
+    const pdf = await buildPdf(await cutPieces(png, f, meta.cells), f);
+    const dir = path.join(root, "output", id);
+    await mkdir(dir, { recursive: true });
+    await writeFile(path.join(dir, `output_${meta.slug}_${f}.approved.png`), png);
+    const final = path.join(dir, pdfFileName(meta.name, f));
+    await writeFile(`${final}.tmp`, pdf);
+    await rename(`${final}.tmp`, final);
+    entry.approvedAt = new Date().toISOString();
+    await writeFile(path.join(dir, "run.json"), JSON.stringify(meta, null, 2));
+    return { status: 200, pdf: `/api/runs/${id}/pdf?format=${f}` };
+  } catch (e) {
+    return { status: 500, error: e instanceof Error ? e.message : String(e) };
+  } finally {
+    locks.delete(key);
+  }
+}
+
+export async function listRuns(root: string) {
+  const ids = await readdir(path.join(root, "output")).catch(() => [] as string[]);
+  const runs = [];
+  for (const id of ids) {
+    const meta = await readMeta(root, id);
+    if (!meta) continue;
+    const formats = [];
+    for (const format of Object.keys(meta.formats) as Format[]) {
+      const approved = await stat(path.join(root, "output", id, pdfFileName(meta.name, format))).then(() => true, () => false);
+      formats.push({ format, approved });
+    }
+    runs.push({ id, name: meta.name, createdAt: meta.createdAt, formats });
+  }
+  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
+}
diff --git a/src/lib/cut.ts b/src/lib/cut.ts
new file mode 100644
index 0000000..9e2a8c8
--- /dev/null
+++ b/src/lib/cut.ts
@@ -0,0 +1,47 @@
+import sharp from "sharp";
+import { PDFDocument } from "pdf-lib";
+import { CANVAS, type Format } from "./geometry";
+
+// Match cardRect and CANVAS: 3*750+2 = 2252, 3*900+2 = 2702.
+const PIECE = {
+  binder: { w: 750, h: 1050, sx: 751, sy: 1051 },
+  toploader: { w: 900, h: 1200, sx: 901, sy: 1201 },
+};
+
+export function pieceRects(format: Format, cardCells: number[]) {
+  const { w, h, sx, sy } = PIECE[format];
+  const rects = [];
+  for (let cell = 0; cell < 9; cell++) {
+    if (format === "binder" && cardCells.includes(cell)) continue;
+    rects.push({ cell, left: (cell % 3) * sx, top: Math.floor(cell / 3) * sy, width: w, height: h });
+  }
+  return rects;
+}
+
+export async function cutPieces(png: Buffer, format: Format, cardCells: number[]): Promise<Buffer[]> {
+  const m = await sharp(png).metadata();
+  const { w, h } = CANVAS[format];
+  if (m.width !== w || m.height !== h) throw new Error(`cut: image is ${m.width}x${m.height}, expected ${w}x${h}`);
+  // extract only: no resize, so pixels are copied as-is. Alpha is flattened on white; opaque RGB is untouched.
+  return Promise.all(
+    pieceRects(format, cardCells).map(({ cell: _c, ...rect }) => {
+      let s = sharp(png).extract(rect);
+      if (m.hasAlpha) s = s.flatten({ background: "#ffffff" });
+      return s.removeAlpha().png().toBuffer();
+    }),
+  );
+}
+
+export async function buildPdf(pieces: Buffer[], format: Format): Promise<Uint8Array> {
+  const { w, h } = PIECE[format];
+  const doc = await PDFDocument.create();
+  for (const p of pieces) {
+    const img = await doc.embedPng(p);
+    const page = doc.addPage([(w * 72) / 300, (h * 72) / 300]);
+    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
+  }
+  return doc.save();
+}
+
+export const pdfFileName = (name: string, format: Format) =>
+  `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim()} ${format}.pdf`;
diff --git a/src/lib/engines/figma.ts b/src/lib/engines/figma.ts
index 8a8986d..2210de4 100644
--- a/src/lib/engines/figma.ts
+++ b/src/lib/engines/figma.ts
@@ -84,6 +84,21 @@ async function askJson(deps: FigmaDeps, prompt: string, tries: number) {
   }
 }
 
+export async function exportFrame(deps: FigmaDeps, frameId: string, format: Format): Promise<Buffer> {
+  const exp = await askJson(
+    deps,
+    `Use the Figma MCP tools. Call download_assets with fileKey "${deps.fileKey}" and nodeId "${frameId}". Reply with ONLY JSON: {"exportUrl":"..."}`,
+    2,
+  );
+  const res = await deps.fetch(exp.exportUrl);
+  if (!res.ok) throw new Error(`figma: export download failed: ${res.status}`);
+  const png = Buffer.from(await res.arrayBuffer());
+  const m = await sharp(png).metadata();
+  const { w, h } = CANVAS[format];
+  if (m.width !== w || m.height !== h) throw new Error(`figma: export is ${m.width}x${m.height}, expected ${w}x${h}`);
+  return png;
+}
+
 export async function publishToFigma(input: FigmaInput, deps: FigmaDeps) {
   const { fileKey } = deps;
   const script = buildFrameScript({
@@ -116,21 +131,12 @@ export async function publishToFigma(input: FigmaInput, deps: FigmaDeps) {
     if (!body.success) throw new Error(`figma: upload failed: ${body.error ?? res.status}`);
   }
 
-  const exp = await askJson(
-    deps,
-    `Use the Figma MCP tools. Call download_assets with fileKey "${fileKey}" and nodeId "${reply.frameId}". Reply with ONLY JSON: {"exportUrl":"..."}`,
-    2,
-  );
-  const res = await deps.fetch(exp.exportUrl);
-  if (!res.ok) throw new Error(`figma: export download failed: ${res.status}`);
-  const png = Buffer.from(await res.arrayBuffer());
-  const m = await sharp(png).metadata();
-  const { w, h } = CANVAS[input.format];
-  if (m.width !== w || m.height !== h) throw new Error(`figma: export is ${m.width}x${m.height}, expected ${w}x${h}`);
+  const png = await exportFrame(deps, String(reply.frameId), input.format);
   const pngPath = path.join(input.workDir, `output_${input.name}_${input.format}.png`);
   await writeFile(pngPath, png);
   return {
     url: `https://www.figma.com/design/${fileKey}/?node-id=${String(reply.frameId).replace(":", "-")}`,
     pngPath,
+    frameId: String(reply.frameId),
   };
 }
diff --git a/src/lib/engines/types.ts b/src/lib/engines/types.ts
index 6bce1f1..1d12b72 100644
--- a/src/lib/engines/types.ts
+++ b/src/lib/engines/types.ts
@@ -11,7 +11,7 @@ export type FigmaInput = {
 export interface Engines {
   clean(inPng: string, outPath: string): Promise<void>;
   fill(inPng: string, outPath: string): Promise<void>;
-  figma(input: FigmaInput): Promise<{ url: string; pngPath: string }>;
+  figma(input: FigmaInput): Promise<{ url: string; pngPath: string; frameId: string }>;
 }
 
 export const CLEAN_PROMPT =
diff --git a/src/lib/pipeline.ts b/src/lib/pipeline.ts
index 89e64a6..da67d39 100644
--- a/src/lib/pipeline.ts
+++ b/src/lib/pipeline.ts
@@ -9,6 +9,7 @@ export type RunInput = {
   cells: number[];
   formats: Format[];
   name?: string;
+  fileKey?: string;
 };
 export type StepStatus = "pending" | "running" | "done" | "failed";
 export type OnStep = (label: string, status: StepStatus, error?: string) => void;
@@ -21,6 +22,14 @@ export const slugify = (s: string) =>
 
 export const runName = (i: RunInput) => slugify(i.name || i.cards[0]?.name || "");
 
+export const displayName = (i: RunInput) =>
+  (i.name || i.cards[0]?.name || "")
+    .replace(/\.[a-z0-9]+$/i, "")
+    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
+    .replace(/\s+/g, " ")
+    .trim()
+    .slice(0, 80) || runName(i);
+
 export function validateRun(i: RunInput, fileKey = process.env.FIGMA_FILE_KEY): string[] {
   const e: string[] = [];
   if (i.cards.length < 1 || i.cards.length > 3) e.push("Pick 1 to 3 cards.");
@@ -76,7 +85,7 @@ export async function runPipeline(
     );
   }
 
-  const results: { format: Format; figmaUrl: string; pngPath: string }[] = [];
+  const results: { format: Format; figmaUrl: string; pngPath: string; frameId: string }[] = [];
   for (const format of input.formats) {
     const canvas = await step(`${format} canvas`, () =>
       composeCanvas(format, cleaned.map((png, k) => ({ cell: input.cells[k], png }))),
@@ -97,7 +106,7 @@ export async function runPipeline(
         workDir: work,
       }),
     );
-    results.push({ format, figmaUrl: r.url, pngPath: r.pngPath });
+    results.push({ format, figmaUrl: r.url, pngPath: r.pngPath, frameId: r.frameId });
   }
 
   // Only a fully successful run writes to output/.
@@ -105,6 +114,16 @@ export async function runPipeline(
     const dir = path.join(root, "output", id);
     await mkdir(dir, { recursive: true });
     for (const r of results) await cp(r.pngPath, path.join(dir, `output_${name}_${r.format}.png`));
+    const meta = {
+      id,
+      name: displayName(input),
+      slug: name,
+      cells: input.cells,
+      fileKey: input.fileKey,
+      createdAt: new Date().toISOString(),
+      formats: Object.fromEntries(results.map((r) => [r.format, { frameId: r.frameId }])),
+    };
+    await writeFile(path.join(dir, "run.json"), JSON.stringify(meta, null, 2));
   });
   return results.map((r) => ({ format: r.format, figmaUrl: r.figmaUrl }));
 }
diff --git a/src/lib/runs.ts b/src/lib/runs.ts
index ae4af1c..ee89028 100644
--- a/src/lib/runs.ts
+++ b/src/lib/runs.ts
@@ -19,9 +19,11 @@ const store: Store = (g.__runs ??= { map: new Map() });
 export const getRun = (id: string) => store.map.get(id);
 export const isBusy = () => store.active !== undefined;
 
+export const defaultFigmaDeps = (fileKey: string) => ({ claude: (p: string) => runClaude(p), fetch, fileKey });
+
 export const defaultEngines = (fileKey: string): Engines => ({
   ...agyEngines(),
-  figma: (i) => publishToFigma(i, { claude: (p) => runClaude(p), fetch, fileKey }),
+  figma: (i) => publishToFigma(i, defaultFigmaDeps(fileKey)),
 });
 
 export function startRun(input: RunInput, engines: Engines, root?: string) {
```
