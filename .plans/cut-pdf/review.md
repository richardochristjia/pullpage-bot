# Review: cut-pdf (git diff pullpage-bot...cut-pdf)

Method: read context-pack.md first (cited as "pack"); opened page.tsx diff and `.claude/`/`.agents/` (no repo review skill or agent; `.agents/` holds only RECORD.md). Interrogate's four reviewer agents were NOT spawned (unattended run, effort budget); the lead did all four angles directly and proved each finding with real runs. check-impact was run on the same diff. Baseline: `npm test` 36/36 pass, `npm run lint` clean.
Probes live outside the repo: scratchpad `probe/probe.test.ts` and `probe/p2.test.ts` (alias `@` -> repo src, real sharp/pdf-lib, real route handlers).

## Must-fix
None. Nothing found that breaks a written repo rule, blocks acceptance criteria, or leaks data.

## Consider
1. Lost update of `approvedAt` when two formats of one run are approved at once. `src/lib/approve.ts:215-233`: meta is read before the lock and whole `run.json` is rewritten, locks are per run+format, so binder and toploader overwrite each other.
   Proof: probe "concurrent binder+toploader": both return 200, final run.json = `{"binder":{"frameId":"1:2"},"toploader":{...,"approvedAt":...}}` (binder's approvedAt gone). PDFs themselves are fine (8 pages, 180x252 pt).
   Impact is low because `approvedAt` is write-only: `grep approvedAt src` finds only approve.ts:13 and :51; the UI uses `stat` of the PDF (approve.ts:250). Fix is either drop `approvedAt` or re-read meta under a per-run lock before writing. Failing test = the probe's last assertion.
2. Rename failure leaves a stale `<name> <format>.pdf.tmp` and a `.approved.png`. `approve.ts:228-231`. Proof (p2 probe, final path pre-made as a directory): 500 EISDIR, `readdir` shows `X binder.pdf.tmp`. No `.pdf` is left and run.json is untouched, so the stated guarantee holds; only the temp file is orphaned (next success overwrites it). Cleanup in the catch is optional.

## Noted
- Missing `fileKey` (run created while env unset cannot happen since `validateRun` requires it; legacy/hand-edited run.json can): approve returns 500 `run.json has no fileKey`, lock released, nothing written (probe "missing fileKey": dir holds only run.json). A 4xx would be more accurate; message is clear. `approve.ts:223`.
- Parseable but wrong-shape run.json (e.g. `{}` or `5`): `meta.formats[format]` throws outside the try (`approve.ts:216`), so the route 500s unhandled; `listRuns` throws (`approve.ts:249`, probe: "Cannot convert undefined or null to object") and `GET /api/runs` 500s for every run; the page swallows it (page.tsx loadPast catch) so Past runs just vanish. Only the app writes run.json, so needs manual corruption.
- Legacy run `output/397fb47b-.../` has no run.json: image route now 404s (image/route.ts:10), not approvable. Before the change it was already 404 after any restart (in-memory `getRun`), so no regression; matches pack "by design".
- run.json is not written atomically (`pipeline.ts:~126`, `approve.ts:233`); a torn write parses to null and the run disappears from the list. Pre-existing pattern in the save step.

## Verified clean (proof)
- Pixel exactness: probe "opaque RGBA piece == raw extract": piece 1 of binder cell grid is byte-equal to `extract({left:751,...})` raw, 3 channels. No resize anywhere in cut.ts (cut.ts:288-294). Alpha flatten only if `hasAlpha` (semi-transparent pixels blend onto white by design). Gray, palette and rgb16 inputs cut and embed without error (output 8-bit).
- PDF size/order: 8 pages, 180x252 pt for binder (probe); existing cut.test.ts covers row-major order and byte-equal embed.
- Path traversal: `../x`, `..%2f..`, `%2e%2e`, `x/../../package.json`, `../../package.json` -> 404 on image, pdf and approve route handlers (probe "routes reject traversal"). Every fs-touching route goes through `isRunId` (image, pdf via readMeta; approve and list via readMeta). `pdfFileName` strips separators, and `..` in a name cannot escape `path.join(dir, file)`.
- 409 lock: same-format concurrent calls give [200, 409] and a third call is 200 (released). After an exporter throw the second call is 500 "boom", not 409 (probe). `finally` at approve.ts:237.
- Failure leaves no PDF: exporter throw and wrong-size export (100x100) leave only run.json, byte-identical before/after.
- run.json only on success: written last inside the `save` step (pipeline.ts:117-126), after all PNG copies; failed steps never reach it.

## check-impact
- What it does: re-exports a Figma frame, cuts it with fixed rects, writes PDF per format, persists run metadata; image route gate switches from in-memory `getRun` to `isRunId`+run.json; `Engines.figma` gains `frameId`; run name no longer overwritten by the slug (route.ts) and a display name goes to run.json.
- One fact it is safe because of: the `.approved.png` file added next to the originals does not collide with the image route's `endsWith("_${format}.png")` match (image/route.ts:10-11). Proof level 3 (string walk: `output_x_binder.approved.png`.endsWith(`_binder.png`) is false), plus `tsc` clean for the `Engines.figma` type change; only `runs.ts` implements it. Not run in the real app (no Figma, no `.harness/`).
- Cleared: only caller of `startRun`/`runPipeline` is route.ts:35 and tests; `fileKey` threaded from env there. `output/` is git-ignored. No other consumer of `getRun` removed.
- Before merge: manual Figma checks in the pack (Goldeen binder, `pdfimages` compare) remain unrun.

## Dismissed
- "Lock acquired after an await in approveFormat": the has/add pair is synchronous, so no race (probe shows exactly one 409).
- "`.approved.png` hijacks image route": cleared above.
- Content-Disposition lacks an ASCII filename fallback: `filename*` is supported by all current browsers.
