## Layout
- [x] Add `PAD`, `GAP`, `cutFrameSize` and `cutLayout` to `src/lib/cut.ts`
- [x] Make `cutPieces` slice a cut-frame export at layout `dst` spots with a size check
- [x] Update `src/lib/cut.test.ts` (spec cases 1–6)

## Figma cut
- [x] Add `buildCutScript` (clone per piece, drop `/^card\d+$/`, offset, old-cut removal)
- [x] Add `cutToFigma` (one try, returns cutFrameId)
- [x] Generalise export to `exportNode(deps, nodeId, w, h)`; keep `exportFrame` as wrapper
- [x] Tests in `src/lib/engines/figma.test.ts` (spec cases 7–9)

## Cut route
- [ ] Add `cutFormat` to `src/lib/approve.ts` (guards, shared lock, save cutFrameId, clear approvedAt)
- [ ] Add `src/app/api/runs/[id]/cut/route.ts`

## Make PDF
- [ ] `approveFormat` requires `cutFrameId` (409 `Cut to Figma first.`) and exports the cut frame
- [ ] Update approve route exporter to `exportNode` at `cutFrameSize`
- [ ] `listRuns` reports `cut`
- [ ] Tests in `src/lib/approve.test.ts` (spec cases 10–12)

## UI
- [ ] Replace `Approve` with `CutAndPdf` in `src/app/page.tsx` (two buttons, Figma link, hint) for current and past runs

## Docs
- [ ] Update README "Use" steps

## Verification
- [ ] AC1: `cutLayout` binder [4] → 8 entries without cell 4; toploader [4] → 9
- [ ] AC2: `buildCutScript` removes only `card<n>` layers, offsets clones, one piece per entry at `dst`
- [ ] AC3: Make PDF without cut → 409 `Cut to Figma first.`, no PDF
- [ ] AC4: wrong cut-frame export size → clear error, no PDF
- [ ] AC5: sliced pieces byte-equal to reference extracts; PDF pages as today
- [ ] AC6: cut route 404 for `../x`/bad format/missing run, 409 on overlap; success saves cutFrameId and clears approvedAt
- [ ] AC7: `npm test`, `npm run lint`, `npm run build` pass
- [ ] Record Updates: (1) review the complete implementation; (2a) if it matches the planned Record Updates in plan.md, replace the two `(cut)` entries named there with the four new entries, verbatim, in `.agents/RECORD.md`; (2b) if the implementation diverged, do not write a wrong entry — surface the divergence in the final summary

## Manual checks
- [ ] manual: toploader run → Cut to Figma → cut frame with 9 pieces, card cell shows background only
- [ ] manual: binder run → Cut to Figma → card cell blank, other 8 present
- [ ] manual: edit inside one piece in Figma → Make PDF → page shows edit; pages 2.5×3.5 in / 3×4 in
