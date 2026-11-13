## Link parsing
- [x] Add `parseFrameLink` to new `src/lib/links.ts` (host, /design|/file, branch key, configured key, node-id)
- [x] Add parse cases to `src/lib/links.test.ts`

## Clean frame
- [x] Add `cleanFrame` to `Engines` in `src/lib/engines/types.ts`
- [x] Add `buildCleanFrameScript` and `publishCleanFrame` to `src/lib/engines/figma.ts`, with tests
- [x] Add the `clean figma` step and `cleanFrameId` meta to `runPipeline`; add optional `cleanFrameId` to `RunMeta`
- [x] Wire `cleanFrame` in `defaultEngines`; update `pipeline.test.ts` fakes and add the clean-frame tests

## Link cut
- [x] Add `buildLinkCutScript` (format from size, cells from card layers, replace `cut_<name>` sibling, page-parent check)
- [x] Add `cutLinkInFigma` (one Claude call, validate reply)
- [x] Test the script against a fake `figma` object (binder cell 4, toploader, bad size) and the single-call rule

## Link export
- [x] Add `buildReadCutScript` and `readCutFrame` (retry 2)
- [x] Add `exportLink` and `findLinkPdf` to `links.ts` (format from cut size, cells from pieces, layout check, atomic PDF write, old PDF cleanup)
- [x] Test export: 6-page binder PDF, wrong PNG size writes nothing, toploader mismatch, re-export cleanup

## API
- [x] Add `withLinkLock` and the lock test (409, released after throw)
- [x] Add `POST /api/links/cut`, `POST /api/links/export`, `GET /api/links/pdf` (400/409/500 mapping, parse before lock)

## UI
- [ ] Add the `LinkTools` section to `page.tsx`: two textareas, serial loops, per-line status, cut appends to the export box, Export only on click

## Docs
- [ ] Update `README.md` with the clean frame and the Links section, including the card-layer naming caveat

## Verification
- [ ] `parseFrameLink` accepts a valid link to the configured file and rejects a foreign file key, a missing node ID and a non-Figma host
- [ ] The link cut script picks binder or toploader from the frame size, throws on any other size, gets the card cells from the `card\d+` layer positions, and `cutLinkInFigma` makes exactly one Claude call
- [ ] Link export slices with cells taken from the piece names, writes `output/links/<node>/<name> <format>.pdf` with one page per piece, and writes nothing when the export PNG is the wrong size
- [ ] The pipeline calls `cleanFrame` once per run with every cleaned card, saves `cleanFrameId`, and fails the run when `cleanFrame` throws
- [ ] While a link job is running, a second link job gets 409
- [ ] `listRuns` still ignores `output/links/`
- [ ] `npm test`, `npm run lint` and `npm run build` pass
- [ ] Record Updates: (1) review the complete implementation against the plan's Record Updates section; (2a) if it matches, write those exact entries into `.agents/RECORD.md`; (2b) if the implementation diverged, do not write a wrong entry. Instead, list the divergence in the final summary for the user to resolve.

## Manual checks
- [ ] manual: Do a run with 2 cards. In Figma, check that `clean_<name>` holds both cleaned cards beside the run frames, and that cutting the run doesn't include it
- [ ] manual: Paste one binder and one toploader frame link and press Cut. Check that both cut frames appear in Figma, that both links show up in the export box, and that no PDF exists yet
- [ ] manual: Press Export. Check that you get two PDFs with the right page counts (binder 9 minus the card count, toploader 9)
- [ ] manual: Cut the same link again. Check that the old cut frame is replaced, not duplicated
