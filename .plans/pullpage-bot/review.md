# Review: pullpage-bot (correctness, security, structure, tests)

Basis: `.plans/pullpage-bot/context-pack.md` (file map, API contracts, criteria 1-10, "do not re-derive" list) and spec `.plans/pullpage-bot/plan.md`.
Baseline: `npm test` passes (18 tests). Throwaway proofs live in
`/private/tmp/claude-501/-Users-167560-KEVIN-Development-Richardo/49bbfaed-3f65-4ad5-96a8-6e8e0a12f1b1/scratchpad/review/r.test.ts`
run with `npx vitest run --config <scratchpad>/review/vitest.config.ts` from the repo. Nothing was added to the repo.

Checked and found correct (no finding): cell geometry for all 9 cells in both formats stays inside the canvas (binder cell 8 ends at x=2252; toploader at 2627 of 2702); `padTo34` gives 788x1050 / 2364x3152 / 2702x3603 and `unpadFrom34` maps back with the right offsets (context-pack "do not re-derive": 56px binder, 1px toploader); step ordering matches the spec (resize, clean per card once, per format canvas, fill, figma, save last); lock release (`.finally` in `runs.ts:218`); `agyEnv` strips both keys.

## Correctness

### C1 (medium, Act on) agy stdout is never drained, so a chatty agy hangs the step to its timeout
- File: `src/lib/engines/agy.ts:18` (`stdio: ["ignore","pipe","pipe"]`) and `:25` (only stderr is read).
- Problem: stdout is a pipe nobody reads. Once agy prints more than the pipe buffer (about 64KB) it blocks on write, never exits, and the step fails after 300 s with "agy timed out". The run lock is held that whole time. `runClaude` does drain stdout; `runAgy` does not.
- Proof: throwaway test F1 spawns a child that writes 4MB to stdout through `runAgy` with a 4 s timeout. It fails with `agy timed out` (a child that exits normally should resolve).
- Fix: `child.stdout?.resume();` (or `stdio: ["ignore","ignore","pipe"]`).

### C2 (medium, Act on) Figma call 1 retry re-runs the frame-creating script
- File: `src/lib/engines/figma.ts:77-85` (`askJson`), used at `:94`.
- Problem: the "one retry" catches every error, including a claude timeout or non-zero exit, not just unparseable JSON, and resends the same prompt. That prompt tells Haiku to run `use_figma` with the create-frame script again. If call 1 got as far as creating the frame (very likely when the failure is the final JSON reply or a timeout), the retry makes a second `output_<name>_<format>` frame, and the first one is orphaned on the `Automation` page. A timeout also doubles the wait to 6 minutes.
- Proof: throwaway test F3: first `claude()` call throws, `publishToFigma` is run, and the prompt containing `use_figma` was sent 2 times (expected 1). Fails now.
- Fix: retry only on parse failure and, for call 1, make the retry prompt "reply again with only the JSON for the frame you just created" (or do not retry call 1). Keep the retry for call 2 (`download_assets` is idempotent).

### C3 (medium, Act on) EXIF orientation is ignored in `toCard`
- File: `src/lib/imaging.ts:8-9`.
- Problem: `sharp(buf).resize(750,1050,{fit:"fill"})` does not call `.rotate()`. A phone or scanner JPEG with orientation 6 or 8 (pixel data landscape, shown portrait) is squashed sideways into 750x1050. The card then goes to agy, Figma and the final PNG sideways. Criterion 2 (750x1050) still passes, so nothing catches it.
- Proof: throwaway test F2: a 1050x750 JPEG, left half red, right half blue, EXIF orientation 6. After `toCard` the bottom-left pixel is red (blue expected once oriented). Fails now.
- Fix: `sharp(buf).rotate().resize(...)`.

### C4 (medium, Act on) POST /api/runs returns 500 on malformed input
- File: `src/app/api/runs/route.ts:8` and `:26`.
- Problem: (a) `await req.formData()` is outside the try, so a non-multipart body throws a TypeError (500, not the 400 `{errors}` in the contract). (b) `JSON.parse` of `"null"` for `cells` or `formats` succeeds, then `validateRun` (`pipeline.ts:31`, `:34`) reads `.length` of null and throws, also uncaught (500).
- Proof: throwaway tests F4 (text/plain body: `TypeError: Content-Type was not one of "multipart/form-data"...`) and F5 (`cells=null` : `Cannot read properties of null (reading 'length')`). Both fail now.
- Fix: move `formData()` into the try, and in the route check `Array.isArray(cells) && Array.isArray(formats)` (or wrap `validateRun` in the same try) so both give 400.

### C5 (low, Consider) A failed `save` step leaves a partial `output/<id>/`
- File: `src/lib/pipeline.ts:104-108`.
- Problem: `mkdir` then `cp` per format. If the second `cp` fails, the first file stays in `output/<id>/` although the run is "failed". Spec: "nothing copied" on failure.
- Proof: throwaway test F6 (binder png exists, toploader png missing): `output` directory exists after the failed run. Fails now.
- Fix: copy into `output/<id>.tmp` then `rename`, or remove the dir in the catch.

## Unproven (no command or test shows it)
- U1 Figma node mapping: `figma.ts:99-103` only checks count and uniqueness of `uploads[].nodeId`, and posts file i to `uploads[i]` by position. The app never sees `bgId`/`cardIds` from the `use_figma` result, so it cannot tell if Haiku swapped the background and a card. This is the known risk in risks.md; not provable without real Figma. Consider.
- U2 `figma.ts:122` `deps.fetch(exp.exportUrl)` and the upload fetches have no abort signal. Node's fetch default (about 300 s header timeout) bounds it, so a hang is long, not infinite. Not run against a stalled server.
- U3 `page.tsx:59-64` ignores a non-OK poll response. After a server restart the run id is unknown (404), so the UI shows "..." forever with the Run button disabled. Also, a pipeline failure outside any step (for example `mkdir` in `pipeline.ts:51`) gives status "failed" with no failed step, so `page.tsx:66` shows nothing. No browser fixture exists (no `.harness/`), so not exercised.
- U4 `runPipeline` upload sizes: `route.ts:10-15` reads every uploaded file fully into memory before `validateRun` applies the 25MB cap, and there is no cap on the count of `cards` entries. Local single-user app; not run.

## (b) Security
- No finding for injection or traversal. Proof: throwaway test `s.test.ts` runs `slugify` on `../../etc/passwd`, `a/b\c`, `$(rm -rf ~)`, `x"; id; "`, `..`, and `a b\nc`; every result matches `^[a-z0-9_-]*$` (passed). Both spawns use argument arrays with no shell (`agy.ts:19`, `figma.ts:45`). Card names and file names never reach the agy prompt (fixed text) and reach the Claude prompt only as a slug or `JSON.stringify` output. Run id is `crypto.randomUUID()` and the image route also requires `getRun(id)` to exist (`image/route.ts:10`), so `output/.work` paths cannot be steered.
- Declared `type` is the client's `File.type` and is not sniffed (`pipeline.ts:28`). A mislabelled file only fails later at `resize`; low, no action.
- Unbounded upload: see U4.

## (c) Structure
- Matches the spec's file list; no extra layers. Nothing to cut.
- Dead code: `Run`-level `steps[].error` set for failed steps only; the `agyEngines(spawn)` and `runAgy` spawn parameters exist for the spec's injected-spawn test, so they are used. `FigmaDeps.fetch`/`claude` injection is used by tests. No dead code found.
- Minor: `extractJson` returns `any` and `publishToFigma` trusts `reply.pageId`/`exportUrl` without checking presence (`exp.exportUrl` undefined gives a "Failed to parse URL" message). Consider only.

## (d) Tests (acceptance criteria not really proven)
- Criterion 5 and 4 use a fake figma that composes locally, as the plan says. They prove the pipeline plumbing, not the real Figma placement; that is manual-only. No gap against the plan.
- Criterion 6 ("rejected before any engine call"): the test calls `validateRun` only. Nothing proves `POST` stops before `startRun`, because there are no route tests (context-pack: "No tests for routes, runs.ts or page.tsx"). C4 shows the route layer is where the bugs are. Act on: add one route test file (400 on bad body, 409 when busy).
- Criterion 9: the pipeline test makes the fake `clean` throw its own message, so it does not run the real "agy returned no image" path end to end; `agy.test.ts` covers that half separately. Together they cover it. Consider only.
- Criterion 8: `jpegUnder` throw path (still too large) is untested. Consider.
- Untested: lock release after failure and 409 while busy (`runs.ts`), `runAgy` timeout and non-zero exit, EXIF (C3), stdout drain (C1), call-1 retry (C2). The throwaway tests F1-F6 can be adapted into the repo as the regression tests for C1-C5.
