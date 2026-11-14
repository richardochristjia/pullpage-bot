# Review: bg-seam-check (correctness)
Cited: context-pack.md, plan.md. Tests: 57 pass (imaging, figma, pipeline).

Verified OK: judge file order [full, raw, ...crops] (pipeline.ts:212, test asserts raw and raw2); gates logic (figma.ts:160); clean gate unchanged; prompt indexes names[0], [1], slice(2).

## consider
- Prompt says "the middle rectangle" (figma.ts:127, singular) but a run takes 1-9 cells (pipeline.ts:49, cells 0..8) and composeCanvas places each cleaned card at its own cell, so a multi-card raw fill has several rectangles and no "middle" one. Proof: `grep -n "middle rectangle" src/lib/engines/figma.ts`; pipeline.test.ts only runs one card, so multi-card wording is untested. Effect: unknown seam sensitivity on multi-card runs (wording was probed only on single-card umbreon runs). Fix: say "any card-art rectangle".
No must-fix findings.
