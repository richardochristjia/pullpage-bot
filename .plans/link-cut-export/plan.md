# Clean frame + link cut and export

Tier L (see `tier.md`): new server API routes and a new user-visible flow.

## Problem

- Cleaned cards are produced and then discarded: they feed the background composite only and never reach Figma (`src/lib/pipeline.ts`, the `clean card N` steps and `composeCanvas`).
- Cut and Make PDF work only from a run's `output/<runId>/run.json` (`src/lib/approve.ts` `cutFormat`, `approveFormat`), one format at a time. A frame already in Figma cannot be cut or exported by pasting its link, and several frames cannot be processed in one go.

## Solution

- Each run also builds a `clean_<slug>` frame on the `Automation` page beside its run frames, holding the cleaned cards loose (not part of any print frame, never touched by cuts).
- A new **Links** section on the page with two textareas:
  1. **Frames to cut** — one Figma frame link per line. **Cut** cuts them one at a time. Each successful cut appends its cut frame link to box 2 (if not already there).
  2. **Cut frames to export** — editable. Nothing exports until the user clicks **Export**, which makes one PDF per link.
- The bot reads format and card cells from Figma, not from `run.json`: format from the frame size (2252×3152 binder, 2702×3602 toploader); card cells from `card\d+` layer positions (cut) or from `piece N` child frames (export).
- Links whose file key differs from `FIGMA_FILE_KEY` are rejected before any Claude call.
- The per-run Cut / Make PDF buttons and their `run.json` flow stay unchanged.

## Dialectical Outcomes (Why)

| Question | Chosen | Rejected and why |
|---|---|---|
| Where cleaned cards live in Figma | **1C** separate `clean_<slug>` frame | 1A hidden layer inside run frame (adds layers the cut clones into every piece); 1B visible in toploader cuts (changes printed output and a recorded rule) |
| How a link's format/cells are known | **2A** read from Figma (size + layer names) | 2B user picks per link (tedious for many links) |
| Existing run buttons | **3A** keep them, add a separate Links section | 3B replace with link flow (drops `run.json` cut/PDF state, breaks recorded cut entries) |
| Other Figma files | **4B** only configured `FIGMA_FILE_KEY` | 4A any file key (unprobed access risk) |

Decisions made by the planner, not asked:
- Links are processed serially (client loops, ~30s each); per-line status; one failure does not stop the rest.
- Link cut frame name is `cut_<source frame name>` (e.g. `cut_output_goldeen-ar_binder`), so it never collides with a run cut `cut_<slug>_<format>` and never invalidates a run's `cutFrameId`. Re-cutting a link removes the existing sibling with that exact name first.
- Clean frame step failing fails the run, like every other step.
- One server-wide lock for link jobs (409 while one is running).

## Phases

1. **Link parsing** — `parseFrameLink(url, fileKey)` in new `src/lib/links.ts`.
2. **Clean frame** — `Engines.cleanFrame`, `publishCleanFrame` in `figma.ts`, a `clean figma` pipeline step after the format loop, `cleanFrameId` saved in `run.json`.
3. **Link cut** — `buildLinkCutScript` + `cutLinkInFigma` in `figma.ts`; one Claude call per link.
4. **Link export** — `buildReadCutScript` + `readCutFrame` in `figma.ts`; `exportLink` in `links.ts` reuses `exportNode`, `cutPieces`, `buildPdf`; PDF to `output/links/<node>/`.
5. **API** — `POST /api/links/cut`, `POST /api/links/export`, `GET /api/links/pdf`, sharing one lock.
6. **UI** — `LinkTools` component in `src/app/page.tsx`.
7. **Docs** — README section; Record entries (Verification phase).

## Relevant Files (Where)

Create:
- `pullpage-bot/src/lib/links.ts` — `parseFrameLink`, link lock, `cutLink`, `exportLink`, `findLinkPdf`.
- `pullpage-bot/src/lib/links.test.ts`
- `pullpage-bot/src/app/api/links/cut/route.ts`
- `pullpage-bot/src/app/api/links/export/route.ts`
- `pullpage-bot/src/app/api/links/pdf/route.ts`

Modify:
- `pullpage-bot/src/lib/engines/types.ts` — add `cleanFrame` to `Engines`.
- `pullpage-bot/src/lib/engines/figma.ts` — `buildCleanFrameScript`, `publishCleanFrame`, `buildLinkCutScript`, `cutLinkInFigma`, `buildReadCutScript`, `readCutFrame`.
- `pullpage-bot/src/lib/engines/figma.test.ts`
- `pullpage-bot/src/lib/pipeline.ts` — `clean figma` step; `cleanFrameId` in meta.
- `pullpage-bot/src/lib/pipeline.test.ts` — fake `cleanFrame`, assert call.
- `pullpage-bot/src/lib/approve.ts` — `RunMeta` gains optional `cleanFrameId?: string`.
- `pullpage-bot/src/lib/runs.ts` — `defaultEngines` wires `cleanFrame`.
- `pullpage-bot/src/app/page.tsx` — Links section.
- `pullpage-bot/README.md` — describe clean frame and Links section.
- `pullpage-bot/.agents/RECORD.md` — Record entries (end of implementation only).

## Key Code Context (What)

`src/lib/engines/types.ts`:
```ts
export interface Engines {
  clean(inPng: string, outPath: string): Promise<void>;
  fill(inPng: string, outPath: string): Promise<void>;
  figma(input: FigmaInput): Promise<{ url: string; pngPath: string; frameId: string }>;
}
```

`src/lib/geometry.ts`:
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

`src/lib/cut.ts` (reuse; do not change):
```ts
export function cutFrameSize(format: Format) // binder 2578x3478, toploader 3028x3928
export function cutLayout(format: Format, cardCells: number[]) // [{cell, src:{x,y}, dst:{x,y}, w, h}], binder skips cardCells
export async function cutPieces(png: Buffer, format: Format, cardCells: number[]): Promise<Buffer[]> // throws if png size != cutFrameSize
export async function buildPdf(pieces: Buffer[], format: Format): Promise<Uint8Array>
```

`src/lib/engines/figma.ts` existing pieces to reuse:
```ts
export type FigmaDeps = { claude: (prompt: string) => Promise<string>; fetch: typeof fetch; fileKey: string };
// Retry only idempotent prompts: re-running the frame-creating one leaves a duplicate frame.
async function askJson(deps: FigmaDeps, prompt: string, tries: number)
export async function exportNode(deps: FigmaDeps, nodeId: string, w: number, h: number): Promise<Buffer>
```
Run cut script body (pattern to copy for link cut; keep `buildCutScript` itself unchanged):
```js
const cut = figma.createFrame();
cut.name = "cut_<name>_<format>";
cut.resize(W, H);
cut.x = src.x + src.width + 200; cut.y = src.y;
cut.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
cut.clipsContent = true;
for (const q of PIECES) {
  const p = figma.createFrame(); p.name = "piece " + (q.cell + 1);
  p.resize(q.w, q.h); p.clipsContent = true; p.fills = [];
  cut.appendChild(p); p.x = q.dx; p.y = q.dy;
  const c = src.clone(); p.appendChild(c);
  c.x = -q.sx; c.y = -q.sy;
  for (const n of [...c.children]) if (/^card\d+$/.test(n.name)) n.remove();
}
return { cutFrameId: cut.id };
```
Upload pattern in `publishToFigma`: `use_figma` script returns node IDs, the prompt asks Claude to call `upload_assets` with `count`, `nodeIds`, `currentPageId`, and reply `{"uploads":[{nodeId,submitUrl}]}`; then each file is POSTed as multipart `file` to its single-use `submitUrl`, checking `body.success`.

`src/lib/runs.ts`:
```ts
export const defaultFigmaDeps = (fileKey: string) => ({ claude: (p: string) => runClaude(p), fetch, fileKey });
export const defaultEngines = (fileKey: string): Engines => ({
  ...agyEngines(),
  figma: (i) => publishToFigma(i, defaultFigmaDeps(fileKey)),
});
```

`src/lib/approve.ts` lock and atomic-write patterns:
```ts
const g = globalThis as unknown as { __approving?: Set<string> };
const locks = (g.__approving ??= new Set());
// ...
await writeFile(`${final}.tmp`, pdf);
await rename(`${final}.tmp`, final);
```
`listRuns` reads `output/*` and skips entries where `readMeta` returns null (non-UUID names), so `output/links/` is ignored.

Cleaned cards: `engines.clean` writes a 750×1050 PNG (`agy.ts` un-pads to the input size, which `toCard` made 750×1050).

## Implementation Algorithm (How)

### 1. `parseFrameLink(url, fileKey = process.env.FIGMA_FILE_KEY)`
- `new URL(url.trim())` (throw `"Not a link."` on failure).
- Host must be `figma.com` or `www.figma.com`, else `"Not a Figma link."`.
- Path `/design/<key>/...` or `/file/<key>/...`; if the path has `/branch/<branchKey>`, use `branchKey`. Missing key → `"Not a Figma file link."`.
- `key !== fileKey` → `"Not the configured Figma file."`. No `fileKey` set → `"FIGMA_FILE_KEY is not set."`.
- `node-id` query param, must match `/^\d+[-:]\d+$/`, else `"Link has no frame node-id."`. Return `{ fileKey: key, nodeId: id.replace("-", ":") }`.

### 2. Clean frame
- `Engines.cleanFrame(input: { name: string; cleaned: Buffer[]; workDir: string }): Promise<{ frameId: string }>`.
- `buildCleanFrameScript({ name, count })`: same page lookup/creation and right-edge placement as `buildFrameScript`; frame `clean_<name>`, size `count*750 + (count-1)*64` × `1050`, no fill; `count` rectangles named `clean1..N` at `x = i*(750+64)`, `y = 0`; returns `{ pageId, frameId, cleanIds }`.
- `publishCleanFrame(input, deps)`: one `askJson` (tries 1) prompt: create_session, use_figma with the script, upload_assets with `count`, `nodeIds = cleanIds`, `currentPageId = pageId`; reply `{"frameId","uploads":[...]}`. Validate `uploads.length === count`, unique node IDs, `frameId` present. POST each cleaned PNG (`clean<k>.png`, `image/png`). Return `{ frameId }`.
- `runPipeline`: after the format loop and before `save`, `const clean = await step("clean figma", () => engines.cleanFrame({ name, cleaned, workDir: work }))`. Save `cleanFrameId: clean.frameId` in `run.json`.
- `defaultEngines`: `cleanFrame: (i) => publishCleanFrame(i, defaultFigmaDeps(fileKey))`.

### 3. Link cut
- `buildLinkCutScript({ nodeId })` embeds a JSON table built in TS:
  `L = { binder|toploader: { w, h (CANVAS), size (cutFrameSize), rects: [cardRect(f, 0..8)], pieces: cutLayout(f, []) mapped to {cell,sx,sy,dx,dy,w,h} } }`.
- Script logic:
  1. `src = await figma.getNodeByIdAsync(nodeId)`; throw `"frame not found"` if missing or `src.type !== "FRAME"`; throw `"frame must sit directly on a page"` if `src.parent.type !== "PAGE"`; `setCurrentPageAsync(src.parent)`.
  2. `fmt` = key of `L` where `Math.round(src.width) === w && Math.round(src.height) === h`; else throw `` `frame is ${W}x${H}, not binder or toploader` ``.
  3. `cardCells` = children named `/^card\d+$/`, mapped to the index of the `rects` entry with `|r.x-n.x| <= 2 && |r.y-n.y| <= 2`, dropping `-1`, deduped.
  4. `cutName = "cut_" + src.name`; remove every `src.parent` child of type FRAME with that exact name.
  5. Build the cut frame exactly like the run cut script, using `L[fmt].size` and `L[fmt].pieces`, skipping pieces whose cell is in `cardCells` when `fmt === "binder"`.
  6. `return { cutFrameId: cut.id, format: fmt, cardCells }`.
- `cutLinkInFigma(deps, nodeId)`: `askJson` tries **1** (not idempotent). Validate `cutFrameId` and `format ∈ FORMATS`. Return `{ cutFrameId, format, cardCells }`.

### 4. Link export
- `buildReadCutScript({ nodeId })`: returns `{ w: Math.round(n.width), h: Math.round(n.height), name: n.name, cells: n.children.filter(c => /^piece \d+$/.test(c.name)).map(c => Number(c.name.slice(6)) - 1) }`; throws `"frame not found"` if missing.
- `readCutFrame(deps, nodeId)`: `askJson` tries **2** (read-only). Prompt: create_session + use_figma verbatim; reply ONLY JSON.
- `exportLink(root, url, deps)` in `links.ts`:
  1. `parseFrameLink` → `nodeId`.
  2. `r = await readCutFrame(deps, nodeId)`. `format` = the `f` where `cutFrameSize(f)` equals `{r.w, r.h}`; else throw `` `not a cut frame: ${w}x${h}` ``.
  3. `cardCells` = binder: cells `0..8` not in `r.cells`; toploader: `[]`. Check `cutLayout(format, cardCells).map(p => p.cell)` equals sorted unique `r.cells`; else throw `"cut frame pieces do not match the layout"` (catches toploader missing pieces and binder with zero pieces).
  4. `png = await exportNode(deps, nodeId, r.w, r.h)`; `pdf = await buildPdf(await cutPieces(png, format, cardCells), format)`.
  5. Dir `output/links/<nodeId with ":" → "-">/`; file `pdfFileName(r.name, format)` (strip a leading `cut_` from the name first). Write `.tmp`, rename, then delete any other `*.pdf` in that dir.
  6. Return `{ pdf: "/api/links/pdf?node=<node-dashed>", format, pages: pieces.length }`.
- `findLinkPdf(root, node)`: `node` must match `/^\d+-\d+$/`; return the path of the single `*.pdf` in the dir, or `null`.

### 5. Lock and API
- In `links.ts`: `const g = globalThis as unknown as { __linkBusy?: boolean }`. `withLinkLock(fn)` returns `{ status: 409, error: "Busy." }` if set; otherwise sets it, runs `fn`, and clears it in `finally`.
- `cutLink(url, deps)` / `exportLink` wrapped by route handlers as: parse errors → 400 `{ error }`; busy → 409; other errors → 500 `{ error }`; success → 200.
- `POST /api/links/cut`, body JSON `{ url }` → `{ cutUrl: "https://www.figma.com/design/<key>/?node-id=<id dashed>", format, cardCells }`. Deps: `defaultFigmaDeps(process.env.FIGMA_FILE_KEY!)`.
- `POST /api/links/export`, body `{ url }` → `{ pdf, format, pages }`.
- `GET /api/links/pdf?node=12-3` → PDF with `content-disposition: attachment; filename*=UTF-8''<file>`, else 404 (same as `api/runs/[id]/pdf/route.ts`).
- All routes `export const runtime = "nodejs"`. Parsing happens before the lock is taken, so a bad link never waits on the lock and never calls Claude.

### 6. UI (`LinkTools` in `page.tsx`, rendered after Past runs, inline-style like the rest)
- State: `cutText`, `exportText`, `cutStatus: {url, text, ok}[]`, `exportStatus: {url, text, ok, pdf?}[]`, `busy: "" | "cut" | "export"`.
- `lines = text.split("\n").map(s => s.trim()).filter(Boolean)`, deduped.
- Cut: for each line in order → POST; on 200 set status `done · <format>` and `setExportText(prev => prev.split("\n").map(s=>s.trim()).includes(cutUrl) ? prev : (prev.trim() ? prev.trimEnd() + "\n" : "") + cutUrl)`; on error set status to the error. Continue to the next line regardless.
- Export: same loop against `/api/links/export`; on success show a `Download PDF` link to `pdf`.
- Both buttons are disabled while `busy`; textareas stay editable. Cut **never** calls export.
- Hint text under the export box: "Check the cut frames in Figma first. Export runs only when you click."

## Anti-Goals (Out of Scope)

- No automatic export after cut.
- No links from other Figma files, no branch-file support beyond parsing the key.
- No changes to the per-run Cut / Make PDF buttons, `cutFormat`, `approveFormat` or `buildCutScript`.
- No link history persisted across reloads (UI state only; PDFs persist on disk).
- No fix for the cut frame overlapping neighbouring frames.
- No parallel processing of links.
- No cleaned cards inside the print frames or cut pieces.

## Edge Cases & Gotchas

- `cutLinkInFigma` must not retry: a retry after a partial run leaves a duplicate cut frame. `readCutFrame` may retry.
- Figma reports float sizes; compare with `Math.round`.
- Frames nested in a section or group: reject (coordinates and placement assume a page parent).
- A frame whose card layers aren't named `card\d+` is cut with no card cells. For binder that gives 9 pieces with the cards baked into the background. Accepted; note it in the README.
- The user may paste a cut frame link into the cut box: its size doesn't match a canvas, so it fails with the size error. Fine.
- The user may paste a run frame into the export box: its size isn't a cut size, so it fails with `not a cut frame`.
- Duplicate lines in a box are processed once.
- Re-export with a renamed frame: the old PDF in the dir is deleted after the new one lands.
- Cleaned-card count is 1 to 3; the clean frame width depends on it.
- `node-id` in URLs uses `-`; Figma API uses `:`. The on-disk folder uses `-`.
- `pipeline.test.ts` `fakes()` must implement `cleanFrame`, or the type check fails.

## Navigation Anchors

- `runPipeline` in `src/lib/pipeline.ts`: the format loop and the `save` step.
- `publishToFigma`, `buildCutScript`, `exportNode` and `askJson` in `src/lib/engines/figma.ts`.
- `cutFrameSize`, `cutLayout`, `cutPieces`, `buildPdf` and `pdfFileName` in `src/lib/cut.ts`.
- `defaultEngines` and `defaultFigmaDeps` in `src/lib/runs.ts`.
- `src/app/api/runs/[id]/pdf/route.ts`: the template for the link PDF route.
- `Page` and `CutAndPdf` in `src/app/page.tsx`.

## Dependency Mappings

- No new npm packages. Reuse `sharp`, `pdf-lib` (through `cut.ts`) and `vitest`.
- `links.ts` depends on `engines/figma.ts` (`exportNode`, `readCutFrame`, `cutLinkInFigma`, `FigmaDeps`), `cut.ts` and `geometry.ts`.
- The routes depend on `links.ts` and `runs.ts` (`defaultFigmaDeps`).

## Acceptance Criteria

Automated:
1. `parseFrameLink` accepts a valid link to the configured file and rejects a foreign file key, a missing node ID and a non-Figma host (`links.test.ts`).
2. The link cut script picks binder or toploader from the frame size, throws on any other size, and gets the card cells from the `card\d+` layer positions. `cutLinkInFigma` makes exactly one Claude call (`figma.test.ts`).
3. Link export slices with cells taken from the piece names, writes `output/links/<node>/<name> <format>.pdf` with one page per piece, and writes nothing when the export PNG is the wrong size (`links.test.ts`).
4. The pipeline calls `cleanFrame` once per run with every cleaned card, saves `cleanFrameId` to `run.json`, and fails the run when `cleanFrame` throws (`pipeline.test.ts`).
5. While a link job is running, a second link job gets 409 (`links.test.ts`).
6. `listRuns` still ignores `output/links/` (`approve.test.ts` or `links.test.ts`).
7. `npm test`, `npm run lint` and `npm run build` pass.

Manual:
- manual: Do a run with 2 cards. In Figma, check that `clean_<name>` holds both cleaned cards beside the run frames, and that cutting the run doesn't include it.
- manual: Paste one binder and one toploader frame link into "Frames to cut" and press Cut. Check that both cut frames appear in Figma, that both links show up in the export box, and that no PDF exists in `output/links/` yet.
- manual: Press Export. Check that you get two PDFs, the binder one with 9 minus the card count pages and the toploader one with 9 pages.
- manual: Cut the same link again. Check that the old `cut_<frame name>` is replaced, not duplicated.

## Test Strategies

| Phase | Test file | Cases |
|---|---|---|
| 1 | `src/lib/links.test.ts` | valid link → `{KEY,"12:3"}`; `/file/` path; branch key; foreign key; no node-id; `example.com`; garbage string |
| 2 | `src/lib/engines/figma.test.ts` | `buildCleanFrameScript` contains `clean_g`, `Automation`, `count` rects; `publishCleanFrame` with fake claude/fetch uploads N PNGs, throws on wrong upload count |
| 2 | `src/lib/pipeline.test.ts` | `cleanFrame` called once with 3 buffers of 750×1050; `run.json` has `cleanFrameId`; throwing `cleanFrame` → run rejects, no `output/` dir |
| 3 | `src/lib/engines/figma.test.ts` | script embeds both formats' sizes, `cut_` + name, `/^card\d+$/`, parent-page check; `cutLinkInFigma` one call, rejects bad format reply. Run the script body against a minimal fake `figma` object (`new AsyncFunction("figma", script)`) for: binder with a card at cell 4 → 8 pieces, `cardCells [4]`, old sibling removed; toploader → 9 pieces; 800×600 → throws size error |
| 4 | `src/lib/links.test.ts` | fake deps: read reply binder pieces missing 3,4,5 + export PNG 2578×3478 → PDF with 6 pages (`PDFDocument.load(...).getPageCount()`); wrong PNG size → throws, no PDF file; toploader with 8 pieces → layout mismatch error; re-export with new name removes old PDF |
| 5 | `src/lib/links.test.ts` | overlapping `withLinkLock` → second returns 409; lock released after throw |
| 6 | manual / lint | `npm run lint`, `npm run build` |

Command: `cd pullpage-bot && npm test && npm run lint && npm run build`.

## Record Updates

- (clean) Each run places its cleaned cards in a separate clean frame beside its run frames on the `Automation` page, outside the print path.
- (links) Pasted Figma frame links are cut one at a time, and each cut frame's link is added to the export list without being exported.
- (links) Link cuts read the format from the frame size and the card cells from the frame's card layers, with no run metadata.
- (links) Link exports read the format and card cells from the cut frame's size and pieces, and run only when a person clicks Export.
- (links) Frame links are accepted only from the configured Figma file.
- (output) Link exports persist one PDF per cut frame to `pullpage-bot/output/links/`.

## Divergences

- Branch `link-cut-export` is cut from `cut-to-figma`, not from `main`: `main` holds only the initial commit and none of the cut work this plan builds on. There is no git remote, so delivery degrades to a local branch.
- `links.ts` also exports `handleLink` (parse, lock and 400/409/500 mapping shared by the routes); not in the plan's file list, within its API design.
