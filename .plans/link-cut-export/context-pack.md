# Context pack

BASE: cut-to-figma (merge-base diff `git diff cut-to-figma...link-cut-export`)
CHANGED: src+README only: 15 files, 549 insertions, 16 deletions (plus .plans and .agents/RECORD.md; excluded)

## What this change does
Each run also publishes a `clean_<name>` frame with the cleaned cards (new `clean figma` pipeline step). A new Links section cuts pasted Figma frame links one at a time and exports pasted cut-frame links to PDF, reading format and cells from Figma instead of `run.json`. Spec: `.plans/link-cut-export/plan.md`.

## Files
- `src/lib/links.ts` (new) — `parseFrameLink` :7, `exportLink` :28, `findLinkPdf` :52, `withLinkLock` :61, `cutLink` :71, `handleLink` :78 (400/409/500 mapping)
- `src/lib/links.test.ts` (new) — parse, export, lock tests
- `src/lib/engines/figma.ts` — `buildCleanFrameScript` :33, `buildLinkCutScript` :150, `cutLinkInFigma` :197, `buildReadCutScript` :207, `readCutFrame` :211, `publishCleanFrame` :242 (+129/-)
- `src/lib/engines/figma.test.ts` — tests for the above, incl. script run against a fake `figma`
- `src/lib/engines/types.ts` — `CleanFrameInput`, `Engines.cleanFrame` :11-17
- `src/lib/pipeline.ts` :112,:125 — `clean figma` step; `cleanFrameId` saved in run.json
- `src/lib/pipeline.test.ts` — fake `cleanFrame`, call/failure asserts
- `src/lib/runs.ts` :26 — wires `cleanFrame` in `defaultEngines`
- `src/lib/approve.ts` :12 — `RunMeta.cleanFrameId?`
- `src/app/api/links/{cut,export,pdf}/route.ts` (new, 12-14 lines each) — thin wrappers over `handleLink` / `findLinkPdf`
- `src/app/page.tsx` :74 — `LinkTools` component (+67)
- `README.md` — Links and clean frame docs

## API contracts
- `POST /api/links/cut` body `{url}` → 200 `{cutUrl, format, cardCells}`; 400 bad link; 409 busy; 500 error. Shape built in `links.ts:71-76`.
- `POST /api/links/export` body `{url}` → 200 `{pdf, format, pages}`; same errors. `links.ts:28-50`.
- `GET /api/links/pdf?node=12-3` → PDF attachment or 404. `links.ts:52`.
- Engine: `Engines.cleanFrame(CleanFrameInput) → {frameId}` declared `src/lib/engines/types.ts:11-17`.
- Figma replies (parsed by `askJson`, `figma.ts:98`): cut `{cutFrameId, format, cardCells}` (`figma.ts:197`); read `{w,h,name,cells}` (`figma.ts:211`).

## Test entry points
All: `npm test` (vitest run), then `npm run lint`, `npm run build`.
- `src/lib/links.test.ts` — `npx vitest run src/lib/links.test.ts`
- `src/lib/engines/figma.test.ts` — `npx vitest run src/lib/engines/figma.test.ts`
- `src/lib/pipeline.test.ts` — `npx vitest run src/lib/pipeline.test.ts`
- No tests for routes or `page.tsx`.

## Acceptance criteria (verbatim from plan.md)
Automated:
1. `parseFrameLink` accepts a valid link to the configured file and rejects a foreign file key, a missing node ID and a non-Figma host (`links.test.ts`).
2. The link cut script picks binder or toploader from the frame size, throws on any other size, and gets the card cells from the `card\d+` layer positions. `cutLinkInFigma` makes exactly one Claude call (`figma.test.ts`).
3. Link export slices with cells taken from the piece names, writes `output/links/<node>/<name> <format>.pdf` with one page per piece, and writes nothing when the export PNG is the wrong size (`links.test.ts`).
4. The pipeline calls `cleanFrame` once per run with every cleaned card, saves `cleanFrameId` to `run.json`, and fails the run when `cleanFrame` throws (`pipeline.test.ts`).
5. While a link job is running, a second link job gets 409 (`links.test.ts`).
6. `listRuns` still ignores `output/links/` (`approve.test.ts` or `links.test.ts`).
7. `npm test`, `npm run lint` and `npm run build` pass.
Manual (outside automated verification, need real Figma):
- manual: Do a run with 2 cards. In Figma, check that `clean_<name>` holds both cleaned cards beside the run frames, and that cutting the run doesn't include it.
- manual: Paste one binder and one toploader frame link into "Frames to cut" and press Cut. Check that both cut frames appear in Figma, that both links show up in the export box, and that no PDF exists in `output/links/` yet.
- manual: Press Export. Check that you get two PDFs, the binder one with 9 minus the card count pages and the toploader one with 9 pages.
- manual: Cut the same link again. Check that the old `cut_<frame name>` is replaced, not duplicated.

## Do not re-derive
- Format comes from frame size (`CANVAS` in `src/lib/geometry.ts`; cut size via `cutFrameSize` in `src/lib/cut.ts`), cells from `card\d+` layer positions (cut) or `piece N` names (export).
- `cutLinkInFigma` must not retry (tries 1, creates frames); `readCutFrame` may (tries 2).
- `cutLink`/`exportLink` parse before the lock, so bad links never hit Claude or 409 (`links.ts:78-91`).
- Link cut frame is `cut_<source name>`, distinct from run cut `cut_<slug>_<format>`; run Cut/Make PDF code (`buildCutScript`, `cutFormat`, `approveFormat`) is unchanged.
- `output/links/` is ignored by `listRuns` (non-UUID names).
- Unverified against real Figma, tracked in `.plans/link-cut-export/risks.md`: Plugin API behaviour, Haiku reshaping the script/reply, unloaded pages, cards off-grid by >2px.
- Not in this change: cut frame overlap with neighbours, auto-export, other file keys.
- `handleLink` is not in plan.md's file list (extra helper in `links.ts`); `parseFrameLink` takes `deps.fileKey` in `exportLink`/`cutLink`.

## Diff
Full diff exceeds the budget. Small files below; read the rest with `git diff cut-to-figma...link-cut-export -- <path>`: `src/lib/engines/figma.ts`, `src/app/page.tsx`, `src/app/api/links/*`, `README.md`, all `*.test.ts`. `src/lib/links.ts` (new, 91 lines): see Files for anchors; read the file.

```diff
--- a/src/lib/approve.ts
@@ -11,2 +11,3 @@ export type RunMeta = {
   fileKey?: string;
+  cleanFrameId?: string;
--- a/src/lib/engines/types.ts
+export type CleanFrameInput = { name: string; cleaned: Buffer[]; workDir: string }; // cleaned: 750x1050 PNGs
 export interface Engines {
+  cleanFrame(input: CleanFrameInput): Promise<{ frameId: string }>;
--- a/src/lib/pipeline.ts
+  const clean = await step("clean figma", () => engines.cleanFrame({ name, cleaned, workDir: work }));
   // Only a fully successful run writes to output/.
+      cleanFrameId: clean.frameId,
--- a/src/lib/runs.ts
-import { publishToFigma, runClaude } from "./engines/figma";
+import { publishCleanFrame, publishToFigma, runClaude } from "./engines/figma";
+  cleanFrame: (i) => publishCleanFrame(i, defaultFigmaDeps(fileKey)),
```
