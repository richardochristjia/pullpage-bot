# Cut to Figma, check, then PDF

Tier L. The planner set it because the change alters a button flow and adds an API route. The user approved it with decisions 1 = yes, 2A and 3A.

## Problem

- The toploader cut keeps the physical card inside its card-cell piece (`src/lib/cut.ts:15`, which skips card cells only for binder). The user's example (Figma section `1816:3375` in file `Zgh77OkLI5fcGcjx0VMKHG`) shows the card cell as background only.
- Cut pieces never reach Figma. The one **Approve** button exports the frame, cuts it and writes the PDF in a single step (`src/lib/approve.ts:43`).
- So the user can't check or fix the pieces before they're printed.

## Solution

- **Cut to Figma** (new): one Claude/use_figma call builds a *cut frame* to the right of the run's frame on the `Automation` page.
  - Each piece is a clipping frame. It holds a clone of the original frame with the `card<n>` layers removed, offset so only its own cell shows.
  - Binder skips card cells, so those spots stay blank. Toploader has all 9 pieces, and card cells show background only.
  - The cut frame ID is saved in `run.json`.
- **You check in Figma** and edit inside the pieces if needed.
- **Make PDF** (the old Approve):
  - Returns 409 when no cut exists.
  - Otherwise it re-exports the **cut frame** once, checks it is exactly the expected size, slices it at the fixed piece spots and writes the PDF. No AI step.

## Dialectical Outcomes (Why)

- **1 = yes:** toploader card cells are background only, and binder still skips card cells. Both match the user's examples (`1816:3375` toploader with 9 pieces and a background-only centre, `1816:3373` binder with a blank centre).
- **2A: pieces are live clipping frames, built from a clone with the cards removed.** The user's edits inside a piece reach the PDF. Rejected, 2B: upload local pixel crops as image fills. That makes the pieces dead pictures, and any fix means re-cutting.
- **3A: one export of the whole cut frame, sliced at fixed spots** (about 30s). Rejected, 3B: export each piece on its own, which is up to 9 Claude calls (4–5 min). The cost of 3A is that pieces must not be moved.
- **The cut container is a FRAME, not a Section.** A probe showed that `download_assets` on a Section exports with 40px of padding (2658×3552 for 2578×3472). Frames export at exact size, and today's frame export size check already relies on that.
- **Square corners:** the example pieces are square at the pixel level. Pieces are plain frames, with no corner radius.
- **Layout:** padding 100px and gap 64px, taken from the example (binder width 2578 matches exactly).

## Probes (done during planning)

| Probe | Result |
|---|---|
| `get_metadata` on `1816:3373` and `1816:3375` | Binder: 8 pieces of 750×1050, card cell absent. Toploader: 9 pieces of 900×1200. Padding 100, gaps about 61–66. |
| `download_assets` on Section `1816:3373` | Export is 2658×3552 against a node of 2578×3472, so 40px of padding. The first piece starts at pixel (140,140), with square corners. |
| Not probed | The clone-and-clip use_figma script was not run against the user's file. The manual checks prove it. |

## Relevant Files (Where)

All paths are under `/Users/167560.KEVIN/Development/Richardo/pullpage-bot/`.

- `src/lib/cut.ts`: add `PAD`, `GAP`, `cutFrameSize(format)` and `cutLayout(format, cardCells)`. `cutPieces` slices a cut-frame export at the layout spots. `pieceRects` is replaced by `cutLayout`, or kept as an internal helper. `buildPdf` and `pdfFileName` are unchanged.
- `src/lib/cut.test.ts`: update for the new layout and slicing.
- `src/lib/engines/figma.ts`: add `buildCutScript(...)` and `cutToFigma(deps, frameId, format, cardCells, oldCutFrameId?)`. `exportFrame` takes the expected size as a parameter, or a sibling `exportNode(deps, nodeId, w, h)` is added. The existing error text stays.
- `src/lib/engines/figma.test.ts`: tests for the script builder and `cutToFigma`.
- `src/lib/approve.ts`: `RunMeta.formats[f]` gains `cutFrameId?`. Add `cutFormat(root, id, format, cutter)`. `approveFormat` requires `cutFrameId` and exports the cut frame. `listRuns` reports `cut`.
- `src/lib/approve.test.ts`: cut and PDF guards.
- `src/app/api/runs/[id]/cut/route.ts` (new): `POST ?format=`.
- `src/app/api/runs/[id]/approve/route.ts`: the exporter exports the cut frame at the cut-frame size.
- `src/app/page.tsx`: replace `Approve` with `CutAndPdf` (two buttons, a link and a hint).
- `README.md`: update the "Use" steps.
- `.agents/RECORD.md`: the entries at the end.

## Key Code Context (What)

`src/lib/geometry.ts`:
```ts
export const CANVAS = { binder: { w: 2252, h: 3152 }, toploader: { w: 2702, h: 3602 } };
export const CARD = { w: 750, h: 1050 };
export function cardRect(format, cell) { /* binder: col*751,row*1051; toploader: col*901+75,row*1201+75 */ }
```
`src/lib/cut.ts` today:
```ts
const PIECE = { binder: { w: 750, h: 1050, sx: 751, sy: 1051 }, toploader: { w: 900, h: 1200, sx: 901, sy: 1201 } };
export function pieceRects(format, cardCells) { /* cells 0..8 row-major; binder skips cardCells; {cell,left,top,width,height} */ }
export async function cutPieces(png, format, cardCells) { /* size check vs CANVAS; sharp extract; flatten alpha on white; removeAlpha */ }
export async function buildPdf(pieces, format) { /* pdf-lib, page = w*72/300 x h*72/300 */ }
```
`src/lib/engines/figma.ts`: the frame is built with card layers named after `label`, which is `card1`, `card2`, … (`pipeline.ts:105`), and a layer named `background`. `askJson(deps, prompt, tries)` asks Claude and parses JSON. Retry only idempotent prompts. `runClaude` allows the tools `create_session,use_figma,upload_assets,download_assets`.
```ts
export async function exportFrame(deps, frameId, format): Promise<Buffer> {
  const exp = await askJson(deps, `Use the Figma MCP tools. Call download_assets with fileKey "${deps.fileKey}" and nodeId "${frameId}". Reply with ONLY JSON: {"exportUrl":"..."}`, 2);
  // fetch, res.ok check, exact size check vs CANVAS[format] -> `figma: export is WxH, expected …`
}
```
The publish prompt pattern: `1) Call create_session with fileKey … 2) Call use_figma with fileKey … and this code verbatim:\n${script}\n … Reply with ONLY JSON: {...}`.

`src/lib/approve.ts`:
```ts
export type RunMeta = { id; name; slug; cells: number[]; fileKey?; createdAt; formats: Partial<Record<Format, { frameId: string; approvedAt?: string }>> };
export type Exporter = (fileKey: string, frameId: string, format: Format) => Promise<Buffer>;
// approveFormat: isFormat+readMeta → 404; lock `${id}:${f}` on globalThis.__approving → 409; export; cutPieces; buildPdf;
// write .approved.png; PDF via .tmp + rename; approvedAt; rewrite run.json; 200 { pdf: `/api/runs/${id}/pdf?format=${f}` }
```
The approve route passes `(k, fid, f) => exportFrame(defaultFigmaDeps(k), fid, f)`. `defaultFigmaDeps` lives in `src/lib/runs.ts:22`.

`src/app/page.tsx`: `Approve({ id, format, approved, onDone })` posts to `/api/runs/${id}/approve?format=` and shows "Cutting…, about 30s", "Re-approve" and a `Download PDF` link. It is used at lines ~195 (current run) and ~214 (past runs). `PastRun.formats` is `{ format, approved }[]`.

## Implementation Algorithm (How)

### Phase 1: Layout (`cut.ts`)
- `PAD = 100` and `GAP = 64`.
- `cutFrameSize(f)` is `{ w: 2*PAD + 3*pw + 2*GAP, h: 2*PAD + 3*ph + 2*GAP }`. That gives binder 2578×3478 and toploader 3028×3928.
- `cutLayout(f, cardCells)`: for each cell 0..8 in row-major order, skip it when the format is binder and the cell holds a card. Each entry is `{ cell, src: { x: col*sx, y: row*sy }, dst: { x: PAD + col*(pw+GAP), y: PAD + row*(ph+GAP) }, w: pw, h: ph }`.
- `cutPieces(png, f, cardCells)` checks the size against `cutFrameSize(f)` and throws `cut: image is WxH, expected …`. It extracts `{ left: dst.x, top: dst.y, width: w, height: h }` with the same alpha handling as today.

### Phase 2: Figma cut (`engines/figma.ts`)
`buildCutScript({ frameId, oldCutFrameId?, name, format, pieces: cutLayout(...), size })` returns use_figma code that:
1. Finds `const src = await figma.getNodeByIdAsync(frameId)` and throws `"frame not found"` if it is missing. It sets the page to src's page.
2. If `oldCutFrameId` resolves to a node, removes it.
3. Creates `cut` = `figma.createFrame()`, named `cut_<name>_<format>`, resized to `size`, at `x = src.x + src.width + 200` and `y = src.y`. Fill is light grey `{r:.9,g:.9,b:.9}` and `clipsContent = true`.
4. For each piece:
   - Create `p` = `createFrame()`, named `piece <cell+1>`, resized to `w×h`, with `clipsContent = true` and no fills. `cut.appendChild(p)`, then set `p.x = dst.x` and `p.y = dst.y`.
   - Make `c = src.clone()` and `p.appendChild(c)`, then set `c.x = -src.x` and `c.y = -src.y`. Clone coordinates become parent-relative after append, so set them after appending.
   - In `c.children`, remove every node whose name matches `/^card\d+$/`. Search only direct children.
5. Returns `{ cutFrameId: cut.id }`.

`cutToFigma(deps, frameId, format, cardCells, oldCutFrameId?)`:
- Prompt: `Use the Figma MCP tools. 1) Call create_session with fileKey … 2) Call use_figma with fileKey … and this code verbatim:\n${script}\nReply with ONLY JSON: {"cutFrameId":"..."}`.
- `askJson` gets tries = 1. The call is not idempotent, although passing `oldCutFrameId` makes a re-cut safe.
- Returns a string ID and throws `figma: no cutFrameId` if it is missing.
- Export: generalise to `exportNode(deps, nodeId, w, h)`, and keep `exportFrame(deps, frameId, format)` as a wrapper around it with `CANVAS[format]` and the same messages.

### Phase 3: Cut route
- In `approve.ts`, `cutFormat(root, id, format, cutter: (fileKey, frameId, format, cells, oldCutFrameId?) => Promise<string>)`:
  - Uses the same guards as approve: invalid id, format or run returns 404.
  - Uses the same lock set with key `${id}:${f}`, so a cut and a PDF for the same format can't overlap. A clash returns 409 `Busy.`
  - Calls the cutter, sets `entry.cutFrameId`, removes `entry.approvedAt` (a new cut makes the old PDF stale), rewrites `run.json`, then returns `{ status: 200, figmaUrl }`, where the URL is `https://www.figma.com/design/<fileKey>/?node-id=<id with ":" → "-">`.
  - Errors return 500.
- `src/app/api/runs/[id]/cut/route.ts`: `runtime = "nodejs"`. `POST` calls `cutFormat(process.cwd(), id, format, (k, fid, f, cells, old) => cutToFigma(defaultFigmaDeps(k), fid, f, cells, old))`.

### Phase 4: Make PDF (`approve.ts`)
- `approveFormat` returns 409 `Cut to Figma first.` when `entry.cutFrameId` is missing. It returns this before taking the lock or doing any work.
- The `Exporter` signature becomes `(fileKey, nodeId, format) => Promise<Buffer>`. It receives `cutFrameId`. The route's exporter is `exportNode(defaultFigmaDeps(k), nid, cutFrameSize(f).w, cutFrameSize(f).h)`.
- The rest is unchanged: `cutPieces`, `buildPdf`, `.approved.png`, temp file then rename, `approvedAt`.
- `listRuns` adds `cut: !!entry.cutFrameId` per format and keeps `approved` as it is.

### Phase 5: UI (`page.tsx`)
- `CutAndPdf({ id, format, cut, approved, onDone })` has its own state for the cut and the PDF.
- **Cut to Figma** shows "Cutting…, about 30s" while busy, then "Re-cut". On success it shows an `Open cut in Figma` link with `target=_blank`.
- **Make PDF** is disabled until `cut` is true or a cut succeeds. It shows "Making PDF…, about 30s" while busy, then "Re-make PDF" and a `Download PDF` link.
- A small hint: "Check the pieces in Figma. Edit inside them, don't move them."
- Errors show inline in red, as today.
- `PastRun.formats` gains `cut: boolean`. The current-run result passes `cut={false}`.
- Keep the inline-style look.

### Phase 6: Docs
- README "Use": after a run, press **Cut to Figma**, check the pieces in Figma, then press **Make PDF**.
- Toploader card cells are background only, and binder card cells are skipped.

## Anti-Goals (Out of Scope)
- Detecting pieces the user moved or resized in Figma. Only a wrong cut-frame size is caught.
- Per-piece export, ZIPs, bleed or crop marks.
- Migrating old runs. They just press Cut to Figma first.
- Changing the run pipeline, the prompts or the main frame.
- Deleting the cut frame when the run is deleted.

## Edge Cases & Gotchas
- After `appendChild`, a clone's x and y are relative to its parent piece. Set the offset after appending. `src.x` and `src.y` are page coordinates, because the frame is a top-level node on the page.
- Remove card layers by the exact pattern `/^card\d+$/`, not by "not background", so layers the user added stay.
- A re-cut removes the old cut frame only when its ID still resolves, so a frame the user deleted is not an error.
- A new cut clears `approvedAt`. The PDF file may still exist on disk, so `listRuns.approved` (file exists) stays true until Make PDF is pressed again. That is acceptable, because the UI shows "Re-make PDF".
- Path traversal: every route checks `isRunId` first, as today.
- The lock key is shared between cut and PDF for the same id and format.
- `fetch` and `claude` are injected, so tests never touch Figma.

## Navigation Anchors
- `cutLayout` and `cutPieces` in `src/lib/cut.ts`
- `buildCutScript`, `cutToFigma` and `exportNode` in `src/lib/engines/figma.ts`
- `cutFormat`, `approveFormat` and `listRuns` in `src/lib/approve.ts`
- `CutAndPdf` in `src/app/page.tsx`

## Dependency Mappings
- No new external dependencies.
- `cut.ts` depends on `geometry.ts`. `figma.ts` depends on `cut.ts` (types and layout) and `geometry.ts`. `approve.ts` depends on `cut.ts`, and its cutter and exporter are injected. The routes depend on `approve.ts`, `engines/figma.ts` and `runs.ts` (`defaultFigmaDeps`).

## Phases (summary)
1. Layout
2. Figma cut
3. Cut route
4. Make PDF
5. UI
6. Docs

## Acceptance Criteria

Automated:
1. `cutLayout("binder", [4])` gives 8 entries with none for cell 4. `cutLayout("toploader", [4])` gives 9 entries.
2. `buildCutScript` output removes only `/^card\d+$/` layers from each clone, offsets each clone by its cell's grid origin, and creates one piece per layout entry at `dst`.
3. Make PDF without a `cutFrameId` returns 409 `Cut to Figma first.` and writes no PDF.
4. A cut-frame export of the wrong size fails with a clear error and writes no PDF.
5. Slicing a synthetic cut-frame export gives pieces byte-equal to `sharp.extract` at the layout spots. PDF page count, order and sizes are as today.
6. The cut route returns 404 for `../x`, a bad format or a missing run, and 409 for a cut overlapping the same id and format. A successful cut saves `cutFrameId` and clears `approvedAt`.
7. `npm test`, `npm run lint` and `npm run build` pass.

Manual:
- manual: on a toploader run, press Cut to Figma. A cut frame appears to the right of the frame with 9 pieces, and the card cell shows background with no card.
- manual: on a binder run, press Cut to Figma. The card cell is blank and the other 8 pieces are present.
- manual: paint over something inside one piece in Figma, then press Make PDF. That PDF page shows the edit, and pages are 2.5×3.5 in for binder and 3×4 in for toploader.

## Test Strategies

| # | File | Case | Expected |
|---|---|---|---|
| 1 | cut.test.ts | layout binder [4] | 8 entries. First is src (0,0), dst (100,100). No cell 4. |
| 2 | cut.test.ts | layout toploader [4] | 9 entries. Cell 4 is src (901,1201), dst (1064,1364). |
| 3 | cut.test.ts | cutFrameSize | binder 2578×3478, toploader 3028×3928 |
| 4 | cut.test.ts | slice synthetic export | Pixel = f(x,y). Pieces are byte-equal to the reference extract at dst. |
| 5 | cut.test.ts | wrong export size | Throws `cut: image is …` |
| 6 | cut.test.ts | PDF pages | Count, order and sizes are as today |
| 7 | figma.test.ts | buildCutScript | Contains the `/^card\d+$/` removal, each dst, each `-src` offset, and the old-cut removal when given |
| 8 | figma.test.ts | cutToFigma | Fake claude returns `{"cutFrameId":"5:6"}` → `"5:6"`. Garbage → throws, with no retry. |
| 9 | figma.test.ts | exportNode / exportFrame | Wrong size throws the existing message |
| 10 | approve.test.ts | no cutFrameId | 409 `Cut to Figma first.`, no PDF written |
| 11 | approve.test.ts | cut then PDF (fakes) | `cutFrameId` saved, `approvedAt` cleared, then PDF written. `listRuns` gives cut true and approved true. |
| 12 | approve.test.ts | cut guards | `../x` → 404, bad format → 404, overlap → 409 |

Run: `npm test && npm run lint && npm run build` in `pullpage-bot/`.

## Record Updates

Replace:
```
- (cut) Approving a format re-exports its Figma frame and cuts it into print pieces by fixed grid geometry, with no AI step.
- (cut) Toploader cuts keep all nine 900×1200 cells.
```
With:
```
- (cut) Cutting a format builds its print pieces in Figma as clipping frames inside a cut frame beside the original frame, with the card layers left out.
- (cut) Making a PDF re-exports the format's cut frame and slices it at fixed piece positions, with no AI step.
- (cut) A PDF can be made only after its format has been cut to Figma.
- (cut) Toploader cuts keep all nine 900×1200 cells, and card cells hold background only.
```

## Run notes
- Base branch: `no-text-backgrounds`, which is unmerged and has the latest code. It holds the text-check work.
- The repo has no git remote, so delivery ends on a local branch.
- There is no fixture at `.harness/`, so the browser walkthrough is skipped.
