# Falsify: pullpage-bot

Re-ran the throwaway proofs (scratchpad `review/r.test.ts`): F1-F6 fail as the review says. The page (`page.tsx:46-51`) always posts multipart with `JSON.stringify` arrays.

- fix: agy stdout never drained (C1, review). Reproduced (F1: 4MB stdout, "agy timed out"). Agy is chatty, so every real run hits it: failed step after 300 s with the lock held. Fix: `child.stdout?.resume();` in `runAgy`. Test: F1.
- fix: EXIF orientation ignored in `toCard` (C3, review). Reproduced (F2, wrong pixel). Phone photos are an expected input, and the output is silently sideways. Fix: `sharp(buf).rotate().resize(...)`. Test: F2.
- narrow: call-1 retry re-runs the frame-creating prompt (C2, review). Reproduced (F3: `use_figma` prompt sent 2 times). Harm: duplicate frame orphaned on the Automation page, an action nobody asked for. Cheapest: give `askJson` a tries count and call it once for call 1; keep the retry for call 2 (`download_assets` is idempotent). No new rule, just a smaller scope. Test: F3.
- leave open: POST /api/runs 500 on non-multipart body or `cells=null` (C4, review). Reproduced (F4, F5) but only by a hand-made request; the only client always sends valid multipart with array JSON. Harm is a 500 the caller can recover from. Defensive check; nothing shows it's needed. (The contract says 400, so if wanted, the cheap fix is `formData()` inside the try plus wrapping `validateRun` in it.)
- leave open: partial `output/<id>/` after a failed `save` (C5, review). Reproduced only by deleting a PNG the pipeline just wrote (F6); real trigger is disk full or similar. Harm: one stray file under a run already shown as failed. Defensive; hypothetical.

## For the fixer
- C1: `child.stdout?.resume()` in `src/lib/engines/agy.ts`.
- C3: add `.rotate()` in `src/lib/imaging.ts`.
- C2 (narrow): no retry on Figma call 1 in `src/lib/engines/figma.ts`; keep it for call 2.
- Regression tests: adapt F1, F2, F3 into the repo.

## For the user (your call)
- None.

## For the PR's open findings
- POST /api/runs returns 500 (not 400) on a hand-made non-multipart body or `cells=null`; the UI never sends these.
- A failed `save` after the first copy can leave a partial `output/<id>/`.
- Unproven, not ruled: U1-U4 (Figma node swap, no fetch abort signal, poll 404 / stepless failure in UI, upload size caps).

## Dismissed
- None.

Side note: throwaway F7 (slug of `v1.2` gives `pika`, not `pika-v2`) fails but is not a review finding; not ruled.
