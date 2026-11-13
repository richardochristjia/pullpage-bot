# Falsify: link-cut-export

your call: `clean figma` runs before save with no retry, so its failure loses the agy work (blast radius, confirmed). Reproduced by the fake cleanFrame throw: 2 run frames, empty output/. Any transient Figma/Claude error hits it. But `<format> figma` steps already fail the run the same way, and the plan said "Clean frame step failing fails the run". The fix (save first, clean best effort) is a new rule. Rule it would add: "clean frame is optional; its failure never fails the run".
fix (tests only): link-cut tests don't pin card-layer removal, 2px tolerance or fill/clip (interrogate). Mutations survived 16/16. Add: no card* children inside pieces, a card nudged 3px must not count, fill and clip asserted. No source change.
leave open: run Cut frame lands on clean_ frame for one-format runs (blast radius). Proven but visual only, and the plan lists cut overlap as out of scope. Two-format runs already overlapped.
dismiss: binder with 9 cards cut into empty frame (interrogate). Run input allows 1 to 3 cards (pipeline.ts:35), so only a hand-built frame hits it. Harm is a recoverable error message; a guard is a defensive check, nothing shows it's needed.

For the fixer: the tests-only finding.
For the user: pipeline.ts:112 reorder.
PR open findings: run Cut overlaps clean_ frame on one-format runs (visual only, plan out of scope).
Dismissed: 9-card binder.
