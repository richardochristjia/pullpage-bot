# Review of d5bb85a (correctness)

Source: .plans/bg-reference-prompt/context-pack.md and plan.md. `npm test` run on the branch: see result below.

## must-fix

1. Corrupt or non-decodable reference passes validation and fails late, unlabelled.
   - src/lib/pipeline.ts:138-146 (sharp conversion) with src/lib/pipeline.ts:49-52 (type-only check, no decode).
   - Proof: scratch vitest (removed) ran runPipeline with bgRef `{type:"image/png", buf:"not an image"}`. `validateRun` returned `[]`. The run then did a clean call (agy quota spent), the clean check finished, and it threw "Input buffer contains unsupported image format" outside any `step()`. Steps seen: resize, clean card 1, clean card 1 check. No failed step is shown to the user, the run just flips to failed.
   - Fix: write bg-ref.png before the clean loop, inside `await step("reference", ...)` (or decode with `sharp(buf).metadata()` in the route and return 400). Moving it before the cleans saves the wasted agy calls.

## nit

1. src/app/page.tsx:168-172: `setBgRef` updater functions have side effects (`createObjectURL`/`revokeObjectURL`). Under React StrictMode the updater runs twice, so one object URL leaks per paste. Unproven in a browser. Fix: read `bgRef` from state outside the updater.
2. src/app/page.tsx:168: UI accepts any `image/*` (gif, svg, heic); the server rejects those after upload with a 400 message. Works as designed, only a late error.
3. src/lib/engines/agy.ts:83: `sharp(extra.ref).png()` does not apply EXIF rotation, so a rotated phone photo is sent sideways. Unproven (no run with an EXIF image).

## checked, no bug

- Prompt order: FILL_PROMPT, ref line, user line, Avoid (agy.test passes; no extra gives the old string).
- Route: string `bgRef` gives 400; blank prompt gives undefined; trim before the 1000 check is consistent with the UI.
- Retry gets the same `extra` plus `avoid`; clean never receives extra.

## unproven

- Manual criteria 7 and 8 (paste, drop, real agy run) not run.
