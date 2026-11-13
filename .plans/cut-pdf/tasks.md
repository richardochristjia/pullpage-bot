## Run metadata on disk
- [x] Add `displayName()` to `src/lib/pipeline.ts` and stop overwriting `name` with the slug in `src/app/api/runs/route.ts`
- [x] Return `frameId` from `Engines.figma` / `publishToFigma` and update test fakes
- [x] Write `output/<id>/run.json` (id, name, slug, cells, fileKey, createdAt, formats[f].frameId) in the save step, with a test

## Export helper
- [x] Extract `exportFrame(deps, frameId, format)` from `publishToFigma` in `src/lib/engines/figma.ts`, same messages and retry, with tests

## Cut + PDF module
- [x] Add `pdf-lib@1.17.1` (exact) to `package.json`
- [x] Create `src/lib/cut.ts` with `pieceRects`, `cutPieces` (exact size check, flatten alpha to white), `buildPdf`, `pdfFileName`
- [x] Create `src/lib/cut.test.ts` covering test cases 1–9 and 13

## Approve route
- [ ] Create `src/lib/approve.ts` with `isRunId`, `readMeta`, per run+format lock, `approveFormat` (temp file + rename, `approvedAt`)
- [ ] Add `defaultFigmaDeps(fileKey)` to `src/lib/runs.ts` and reuse it in `defaultEngines`
- [ ] Create `src/app/api/runs/[id]/approve/route.ts` (POST ?format=)
- [ ] Create `src/lib/approve.test.ts` covering test cases 10–11

## Disk-backed reads
- [ ] Add `listRuns(root)` and `GET /api/runs`
- [ ] Gate `src/app/api/runs/[id]/image/route.ts` on `isRunId` + `run.json` instead of `getRun`
- [ ] Create `src/app/api/runs/[id]/pdf/route.ts` (attachment, UTF-8 filename)

## UI
- [ ] Add the `Approve` control (idle/busy/error/done, Download PDF, Re-approve) under each result in `src/app/page.tsx`
- [ ] Add the Past runs list, refreshed on mount, after a run, and after approve

## Docs
- [ ] Update the README Use/Output section for approve + PDF

## Verification
- [ ] Binder cells [4] gives 8 pieces at 0,1,2,3,5,6,7,8 of 750×1050, and cells [3,4,5] gives 6
- [ ] Toploader gives 9 pieces of 900×1200, including card cells
- [ ] Each piece is byte-equal to `sharp.extract` at its grid rect, with no resampling
- [ ] PDF pages are row-major, binder 180×252 pt, toploader 216×288 pt, and embedded images decode byte-equal to the pieces
- [ ] A wrong-size export fails with a clear error and writes no PDF
- [ ] Approve gives 404 for a non-UUID id, missing run.json or bad format, a path like `../` never reaches the file system, and a concurrent approve gives 409
- [ ] A successful run writes `run.json` with name, slug, cells, fileKey and frameId per format
- [ ] `npm test`, `npm run lint` and `npm run build` pass
- [ ] Record Updates: (1) review the complete implementation; (2a) if it matches the planned Record Updates in plan.md, write those exact entries into `.agents/RECORD.md`; (2b) if it diverged, do not write a wrong entry, and surface the divergence in the final summary instead

## Manual checks
- [ ] manual: Run Goldeen binder, edit a layer in the Figma frame, press Approve. The PDF reflects the edit, has 8 pages, and the pages are 2.5×3.5 in in Preview.
- [ ] manual: Compare against `~/Downloads/Goldeen AR.pdf` from the same frame with `pdfimages -list` / `-png`. The structure is identical, and the pixels match up to export noise.
- [ ] manual: Restart `npm run dev`. The run shows under Past runs and can be approved.
- [ ] manual: A toploader run gives a 9-page PDF at 3×4 in, with each card in its piece and the 75px border intact.
