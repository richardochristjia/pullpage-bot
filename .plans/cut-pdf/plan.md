# Cut approved frames into print pieces and a PDF

Tier L (declared at planning; measured M by file count). Approved by the user with decisions 1B, 2A, 3A.

## Problem

A run ends with a finished frame in Figma (page `Automation`) and a PNG in `output/<runId>/`. To print it, the user cuts the frame into card-sized pieces in Figma by hand and builds a PDF like `~/Downloads/Goldeen AR.pdf`. That is slow, and it is easy to be off by a pixel. The result must be pixel-exact.

## Solution

- Each finished format gets an **Approve & make PDF** button. Past runs show it too, including runs from before a server restart.
- On approval, the server **re-exports that format's Figma frame**, so the user's manual edits in Figma are included. It requires the export to be exactly the canvas size.
- It **cuts the export with fixed grid numbers** (`sharp.extract`). The cut has no AI step.
- It writes **one lossless PDF per format**: one 300 dpi page per piece, in row-major order.

Cut rules:

| Format | Canvas | Piece | Piece origin (col, row = 0..2) | Which cells |
|---|---|---|---|---|
| binder | 2252×3152 | 750×1050 | x = col·751, y = row·1051 | all 9 except every cell that holds a card |
| toploader | 2702×3602 | 900×1200 | x = col·901, y = row·1201 | all 9, card cells included (card + its 75px border) |

PDF pages: binder 180×252 pt (2.5×3.5 in), toploader 216×288 pt (3×4 in). That is px·72/300, with the image drawn full-bleed at (0,0).

## Dialectical Outcomes (Why)

- **No Claude/LLM in the cut.** The user asked whether Claude could cut. An LLM can't place pixels exactly. The cut lines are constants already in `geometry.ts`, so `sharp.extract` is exact and gives the same result every time. Claude stays only in the Figma export, where it is already used.
- **1B: re-export from Figma at approval**, not the saved PNG. The user may tweak the frame in Figma before approving. A probe showed the PNG in `output/397fb…/` is a different generation from the user's PDF, so the saved PNG cannot be trusted to be the approved design. Cost: one `download_assets` Claude call (about 30 s). Rejected: cutting `output/…png` (1A).
- **2A: binder skips every card cell.** A physical card goes in each of those pockets, so a printed piece there is wasted. Rejected: one user-picked "main" cell (2B).
- **3A: persist run metadata to `output/<runId>/run.json`**, so approval survives a restart. Today runs live only in memory (`src/lib/runs.ts:14`). Rejected: approval only while the server is up (3B).
- **`pdf-lib@1.17.1`** (new dependency). A probe showed that embedding PNG crops gives page images byte-identical to the crops after `pdfimages -png`. The structure matches the user's PDF: RGB, 8 bpc, 300 ppi, Flate. `sharp` can't write PDFs. The scratchpad had Python `pypdf`, but it only reads.
- **Keep the original PNG.** The re-export is saved as a separate `.approved.png`.

## Probes (done during planning)

| Probe | Result |
|---|---|
| `pdfinfo` / `pdfimages -list` on `~/Downloads/Goldeen AR.pdf` | 8 pages at 180×252 pt. Each page is one 750×1050 RGB image at 300 ppi, Flate. |
| Cut Figma frame `1797:1097` (file `Zgh77OkLI5fcGcjx0VMKHG`) at the binder grid and compared to the PDF pages | Pages 1–8 are cells 0,1,2,3,5,6,7,8 at offset (0,0). Mean abs diff is about 1/255 (screenshot vs export noise). A 1px shift is 3–5× worse. |
| `pdf-lib@1.17.1` `embedPng` of the crops, then `pdfimages -png` | Byte-identical to the crops |
| Figma example cut sections `1816:3373` (binder) and `1816:3375` (toploader) | Binder: 8 pieces of 750×1050. Toploader: 9 pieces of 900×1200. |

## Relevant Files (Where)

All paths are under `/Users/167560.KEVIN/Development/Richardo/pullpage-bot/`.

- `src/lib/pipeline.ts`: add `displayName()`. The `save` step writes `run.json`. Use the frame ID from the figma engine.
- `src/lib/pipeline.test.ts`: fakes return `frameId`. Assert `run.json` contents.
- `src/lib/engines/types.ts`: `Engines.figma` returns `{ url, pngPath, frameId }`.
- `src/lib/engines/figma.ts`: extract `exportFrame()`. `publishToFigma` calls it and returns `frameId`.
- `src/lib/engines/figma.test.ts`: test `exportFrame` (size check, retry). The happy path asserts `frameId`.
- `src/lib/cut.ts` (new): `pieceRects`, `cutPieces`, `buildPdf`, `pdfFileName`.
- `src/lib/cut.test.ts` (new).
- `src/lib/approve.ts` (new): `isRunId`, `readMeta`, `listRuns`, `approveFormat`, the in-flight lock.
- `src/lib/approve.test.ts` (new).
- `src/lib/runs.ts`: `defaultFigmaDeps(fileKey)` helper, reused by approve.
- `src/app/api/runs/route.ts`: stop overwriting `name` with the slug. Add `GET` (list past runs).
- `src/app/api/runs/[id]/approve/route.ts` (new): `POST ?format=`.
- `src/app/api/runs/[id]/pdf/route.ts` (new): `GET ?format=`.
- `src/app/api/runs/[id]/image/route.ts`: gate on `isRunId` + `run.json`, not `getRun`.
- `src/app/page.tsx`: approve controls on results, and a Past runs list.
- `package.json`: add `pdf-lib` `1.17.1` (exact).
- `README.md`: add the Use / Output section for approve + PDF.
- `.agents/RECORD.md`: entries (last task).

## Key Code Context (What)

`src/lib/geometry.ts` (unchanged; the cut grid reuses its numbers):
```ts
export const CANVAS: Record<Format, { w: number; h: number }> = {
  binder: { w: 2252, h: 3152 },
  toploader: { w: 2702, h: 3602 },
};
export const CARD = { w: 750, h: 1050 };
export function cardRect(format: Format, cell: number) {
  const col = cell % 3; const row = Math.floor(cell / 3);
  return format === "binder"
    ? { x: col * 751, y: row * 1051, ...CARD }
    : { x: col * 901 + 75, y: row * 1201 + 75, ...CARD };
}
```

`src/lib/engines/types.ts`:
```ts
export type FigmaInput = { format: Format; name: string; bg: Buffer; originals: { cell: number; label: string; png: Buffer }[]; workDir: string };
export interface Engines {
  clean(inPng: string, outPath: string): Promise<void>;
  fill(inPng: string, outPath: string): Promise<void>;
  figma(input: FigmaInput): Promise<{ url: string; pngPath: string }>;
}
```

`src/lib/engines/figma.ts`: the export block that becomes `exportFrame` (end of `publishToFigma`):
```ts
const exp = await askJson(deps,
  `Use the Figma MCP tools. Call download_assets with fileKey "${fileKey}" and nodeId "${reply.frameId}". Reply with ONLY JSON: {"exportUrl":"..."}`, 2);
const res = await deps.fetch(exp.exportUrl);
if (!res.ok) throw new Error(`figma: export download failed: ${res.status}`);
const png = Buffer.from(await res.arrayBuffer());
const m = await sharp(png).metadata();
const { w, h } = CANVAS[input.format];
if (m.width !== w || m.height !== h) throw new Error(`figma: export is ${m.width}x${m.height}, expected ${w}x${h}`);
const pngPath = path.join(input.workDir, `output_${input.name}_${input.format}.png`);
await writeFile(pngPath, png);
return { url: `https://www.figma.com/design/${fileKey}/?node-id=${String(reply.frameId).replace(":", "-")}`, pngPath };
```
`export type FigmaDeps = { claude: (prompt: string) => Promise<string>; fetch: typeof fetch; fileKey: string };`
`runClaude(prompt)` spawns `claude -p … --model haiku --allowedTools <figma tools> --output-format json`. Note that its prompt does not call `create_session` for the export. Keep the export prompt as it is (it works today).

`src/lib/pipeline.ts`: save step and naming:
```ts
export const slugify = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export const runName = (i: RunInput) => slugify(i.name || i.cards[0]?.name || "");
// …
await step("save", async () => {
  const dir = path.join(root, "output", id);
  await mkdir(dir, { recursive: true });
  for (const r of results) await cp(r.pngPath, path.join(dir, `output_${name}_${r.format}.png`));
});
```

`src/app/api/runs/route.ts` currently does `startRun({ ...input, name: runName(input) }, …)`, which throws away the display name. The UI sends `name || cards[0].file.name`.

`src/lib/runs.ts`:
```ts
export const defaultEngines = (fileKey: string): Engines => ({
  ...agyEngines(),
  figma: (i) => publishToFigma(i, { claude: (p) => runClaude(p), fetch, fileKey }),
});
```
The in-memory store pattern (`globalThis.__runs`) is the model for the approve lock.

`src/app/api/runs/[id]/image/route.ts` currently returns 404 unless `getRun(id)` is set. That id check is also what guards against path traversal today.

## Implementation Algorithm (How)

### Phase 1: Run metadata on disk
1. Add `displayName(i: RunInput)` to `pipeline.ts`:
   - Start from `i.name || i.cards[0]?.name || ""`.
   - Strip a trailing `.ext`, then remove `/\:*?"<>|` and control chars.
   - Collapse whitespace, trim, and cut to 80 chars.
   - If the result is empty, use `runName(i)`.
2. In `route.ts` POST, pass `input` unchanged (drop the `name: runName(input)` override). `runPipeline` already computes the slug with `runName(input)`.
3. Change `Engines.figma` to return `{ url, pngPath, frameId }`. `publishToFigma` returns `frameId: String(reply.frameId)`.
4. In `runPipeline`, keep `frameId` in `results`. In the `save` step, after copying the PNGs, write `output/<id>/run.json` (pretty JSON):
   ```json
   { "id": "<uuid>", "name": "Goldeen AR", "slug": "goldeen-ar", "cells": [4], "fileKey": "<key>",
     "createdAt": "<ISO>", "formats": { "binder": { "frameId": "1797:1097" } } }
   ```
   `fileKey` comes from a new optional `RunInput.fileKey`. The POST route sets it from `process.env.FIGMA_FILE_KEY`, and tests pass it directly. Leave `validateRun`'s own `fileKey` argument unchanged.

### Phase 2: Export helper
`export async function exportFrame(deps: FigmaDeps, frameId: string, format: Format): Promise<Buffer>`:
- Contains the prompt, retry 2, fetch, `res.ok` check and exact-size check exactly as in the current block.
- Returns the PNG buffer. `publishToFigma` calls it and writes `pngPath` as before.
- Error messages stay the same, so existing tests keep passing.

### Phase 3: Cut + PDF (`src/lib/cut.ts`)
- `PIECE = { binder: { w: 750, h: 1050, sx: 751, sy: 1051 }, toploader: { w: 900, h: 1200, sx: 901, sy: 1201 } }`. Add a comment that these match `cardRect` and the canvas: 3·750+2 = 2252, 3·900+2 = 2702.
- `pieceRects(format, cardCells)`: go through cells 0..8 in row-major order. Binder skips cells in `cardCells`. Return `{ cell, left: col*sx, top: row*sy, width: w, height: h }`.
- `cutPieces(png, format, cardCells)`:
  - Read the metadata and throw `cut: image is WxH, expected …` unless it equals `CANVAS[format]`.
  - For each rect, run `sharp(png).extract(rect).removeAlpha().png()`. Use `removeAlpha` on RGBA and leave RGB as is. If the source has alpha, flatten it onto white first, because `removeAlpha` would drop the alpha and keep the RGB that sits under transparent pixels. Figma exports are opaque in practice. Test both cases.
  - Return `Buffer[]` in rect order. No resize, no kernel: extract only.
- `buildPdf(pieces, format)`:
  - `PDFDocument.create()`. For each piece, `embedPng`, then `addPage([w*72/300, h*72/300])`, then `drawImage(img, { x: 0, y: 0, width, height })` at page size.
  - Return `doc.save()`. Set the title to empty and no producer dates if `pdf-lib` allows it. Not required.
- `pdfFileName(name, format)` returns `` `${name} ${format}.pdf` ``. `name` is already sanitized by `displayName`. Sanitize again here for runs whose metadata was edited by hand.

### Phase 4: Approve (`src/lib/approve.ts` + route)
- `isRunId(s)` checks `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
- `readMeta(root, id)` returns `null` when the id is invalid, or `run.json` is missing or unparseable.
- Lock: a `Set<string>` of `${id}:${format}` on `globalThis.__approving`, the same pattern as `runs.ts`.
- `approveFormat(root, id, format, exporter: (fileKey, frameId, format) => Promise<Buffer>)` returns `{ status: 200, pdf: string } | { status: 404 | 409 | 500, error: string }`. Steps:
  1. Return 404 when `!isRunId(id)`, the format is not in `FORMATS`, the meta is missing, or `meta.formats[format]` is missing.
  2. If the key is locked, return 409 `Already approving.`. Otherwise lock it, and unlock in `finally`.
  3. Export with `exporter(meta.fileKey, frameId, format)`. This already throws on a wrong size.
  4. Run `cutPieces(png, format, meta.cells)` then `buildPdf`.
  5. Write `output_<slug>_<format>.approved.png`, then the PDF to a `.tmp` path, then `rename` to `pdfFileName`. A failure at any step leaves no PDF at the final name, so a stale PDF from an earlier approval is only replaced on success.
  6. Record `approvedAt` in `meta.formats[format]` and rewrite `run.json`.
  7. Return 200 `{ pdf: "/api/runs/<id>/pdf?format=<f>" }`. Errors return 500 `{ error: message }`.
- `defaultFigmaDeps(fileKey)` in `runs.ts` returns `{ claude: (p) => runClaude(p), fetch, fileKey }`. `defaultEngines` uses it. The route's exporter is `(k, fid, f) => exportFrame(defaultFigmaDeps(k), fid, f)`.
- `src/app/api/runs/[id]/approve/route.ts`: `export const runtime = "nodejs"`. `POST` reads `format` from the query, calls `approveFormat(process.cwd(), …)`, and returns `NextResponse.json(body, { status })`.

### Phase 5: Disk-backed reads
- `listRuns(root)` reads `output/*/run.json` (skipping unreadable ones). It returns `[{ id, name, createdAt, formats: [{ format, approved: boolean }] }]`, newest first. `approved` is true when the PDF file exists.
- `GET /api/runs` returns `NextResponse.json(await listRuns(process.cwd()))`.
- Image route: replace `getRun(id)` with `isRunId(id) && readMeta(...)`. Everything else stays the same.
- `GET /api/runs/[id]/pdf?format=`: validate like approve, then read `pdfFileName(meta.name, format)`. Return 404 if it is missing. Headers: `content-type: application/pdf` and `content-disposition: attachment; filename*=UTF-8''<encodeURIComponent(file)>`.

### Phase 6: UI (`src/app/page.tsx`)
- Add a small `Approve({ id, format, approved, onDone })` component with states idle, busy ("Cutting…, about 30s"), error (shows the message), and done.
  - When approved, it shows a `Download PDF` link to the pdf route, and the button reads "Re-approve".
  - The button is disabled while busy.
- Show it under each current-run result, next to Download / Open in Figma.
- "Past runs" section: `fetch("/api/runs")` on mount, again after a run finishes, and again after any approve. Each row shows the name, date, and per format a thumbnail link to the image route plus `Approve`.
- Keep the existing inline-style look. Add no new styling system.

### Phase 7: Docs and record
- README "Use": after a run, check the frame in Figma, edit it if needed, then press Approve & make PDF. Output is `output/<runId>/<Name> <format>.pdf`, with binder pieces 2.5×3.5 in (card cells skipped) and toploader pieces 3×4 in (all 9).
- Record Updates: see below. This is the last Verification task.

## Phases (summary)
1. Run metadata on disk
2. Export helper
3. Cut + PDF module
4. Approve route
5. Disk-backed reads
6. UI
7. Docs

## Anti-Goals (Out of Scope)
- Any AI or vision model in the cut.
- Individual piece PNG downloads, ZIPs, bleed, crop marks, or multi-up print sheets.
- Copying the PDF to `~/Downloads` automatically.
- Following cards the user moved in Figma. The cut uses the cells chosen at run time.
- Approving runs made before this change (they have no `run.json`). No migration.
- Changing the existing pipeline steps, prompts, or the `agy` engines.
- A queue or "one approve at a time globally". The lock is per run and format only.

## Edge Cases & Gotchas
- Path traversal: `id` reaches `path.join(root, "output", id)`. Every route must check `isRunId` first. The image route lost its `getRun` guard, so `isRunId` replaces it.
- Frame deleted or resized in Figma: `download_assets` fails, or the size check throws. Return 500 with the message and write no PDF.
- RGBA export: flatten onto white before cutting so pages are RGB with no soft mask. Opaque RGB passes through byte-exact.
- A binder with cards in 3 cells gives 6 pages. Toploader always gives 9.
- Re-approve overwrites the PDF only on success (temp file + rename).
- `run.json` is written only by the `save` step, so failed runs have none. This matches "only a fully successful run writes to output/".
- `displayName` from a file name like `goldeen_ar.png` gives `goldeen_ar`. The user can type "Goldeen AR" in the run name field.
- The 1px binder gaps and the toploader gaps between cells fall outside every piece. That is intended and matches the user's manual cut.
- `fetch` and `claude` are injected, so tests never touch Figma.

## Navigation Anchors
- `runPipeline` in `src/lib/pipeline.ts` (save step)
- `publishToFigma` / new `exportFrame` in `src/lib/engines/figma.ts`
- `approveFormat` in `src/lib/approve.ts`
- `cutPieces` / `buildPdf` in `src/lib/cut.ts`
- `Page` in `src/app/page.tsx`

## Dependency Mappings
- New: `pdf-lib` `1.17.1` (exact pin, pure JS, no native deps).
- Internal: `cut.ts` depends on `geometry.ts` (`CANVAS`, `Format`). `approve.ts` depends on `cut.ts`, `geometry.ts` and `engines/figma.ts` (types only, the exporter is injected). The routes depend on `approve.ts` and `runs.ts` (`defaultFigmaDeps`).

## Acceptance Criteria

Automated:
1. Binder with card cells [4] gives 8 pieces at cells 0,1,2,3,5,6,7,8, each 750×1050. Cards [3,4,5] give 6 pieces.
2. Toploader with any cards gives 9 pieces of 900×1200, including the card cells.
3. Each piece's raw pixels are byte-equal to `sharp.extract` at its grid rect of the source export. No resampling.
4. PDF pages are in row-major order. Binder pages are 180×252 pt and toploader pages 216×288 pt. Each page's embedded image decodes byte-equal to its piece's raw RGB.
5. An export that is not exactly the canvas size makes approval fail with a clear error and write no PDF.
6. Approve returns 404 for a non-UUID id (e.g. `../x`), a missing `run.json`, or a bad format. A path like `../` never reaches the file system. A concurrent approve of the same run and format returns 409.
7. A successful run writes `run.json` with name, slug, cells, fileKey and frameId per format.
8. `npm test`, `npm run lint` and `npm run build` pass.

Manual:
- manual: Run the Goldeen binder, hide or edit a layer in the Figma frame, then press Approve. The PDF reflects the edit and has 8 pages. Open it in Preview and check the pages are 2.5×3.5 in.
- manual: Compare the new PDF to `~/Downloads/Goldeen AR.pdf` from the same frame with `pdfimages -list` and `pdfimages -png`. The structure is identical, and the pixels match up to Figma export vs screenshot noise.
- manual: Restart `npm run dev`. The run appears under Past runs and can be approved.
- manual: A toploader run gives a 9-page PDF at 3×4 in, and each card sits in its piece with the 75px border intact.

## Test Strategies

| # | File | Case | Expected |
|---|---|---|---|
| 1 | cut.test.ts | binder rects, cells [4] | 8 rects. First (0,0), last (1502,2102), none at (751,1051). |
| 2 | cut.test.ts | binder rects, cells [3,4,5] | 6 rects, middle row absent |
| 3 | cut.test.ts | binder rects, cells [0] | 8 rects, first (751,0) |
| 4 | cut.test.ts | toploader rects | 9 rects of 900×1200, (901,1201) present |
| 5 | cut.test.ts | pixel exactness | Synthetic raw canvas where pixel = f(x,y), e.g. R=x&255, G=y&255, B=(x>>8)^(y>>8). Each piece is byte-equal to the reference extract. |
| 6 | cut.test.ts | PDF binder | 8 pages at 180×252. Each page's image XObject, decoded with pdf-lib `decodePDFRawStream`, is byte-equal to the piece's raw RGB. |
| 7 | cut.test.ts | PDF toploader | 9 pages at 216×288 |
| 8 | cut.test.ts | RGBA input | Pieces have 3 channels. Transparent pixels come out white. |
| 9 | cut.test.ts / approve.test.ts | wrong size (2251×3152) | Throws, and no PDF file is written |
| 10 | approve.test.ts | guards | `../x` gives 404, unknown UUID 404, bad format 404, overlapping call 409 (exporter held on a deferred promise) |
| 11 | approve.test.ts | success with fake exporter | `.approved.png` and `<Name> <format>.pdf` written. `run.json` has `approvedAt`. `listRuns` shows approved. |
| 12 | pipeline.test.ts | run.json | name, slug, cells, fileKey, frameId per format |
| 13 | pipeline.test.ts / cut.test.ts | names | `displayName` turns `goldeen_ar.png` into `goldeen_ar`, and `a/b:c` into `abc`. `pdfFileName("Goldeen AR","binder")` gives `Goldeen AR binder.pdf`. |
| 14 | figma.test.ts | exportFrame | Wrong size throws the existing message. One garbage reply is retried. The publish happy path returns `frameId` `"1:2"`. |

Run: `npm test && npm run lint && npm run build` in `pullpage-bot/`.

## Record Updates

```
- (cut) Approving a format re-exports its Figma frame and cuts it into print pieces by fixed grid geometry, with no AI step.
- (cut) Binder cuts skip every cell that holds a card.
- (cut) Toploader cuts keep all nine 900×1200 cells.
- (output) Approved cuts are persisted as one PDF per format, one 300 dpi page per piece in row-major order, to `pullpage-bot/output/<runId>/`.
- (output) Each finished run persists its name, card cells and Figma frame IDs to a metadata file in its output folder, so approval survives a restart.
```

## Run notes
- Base branch: `pullpage-bot`, not `main`. `main` holds only `.gitignore`. The app exists only on `pullpage-bot`.
- The repo has no git remote. Delivery `pr` can't open a PR or push, so the run ends on a local branch and reports that.
- No fixture at `.harness/`, so the browser walkthrough is skipped. Run `make-fixture` in this repo to enable it.
