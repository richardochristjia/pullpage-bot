# Falsify: background-judge keep-retry rule (pipeline.ts:97)

Read-only. Reproduction taken from review-repro.test.ts.txt (reviewer's run, output checked against the claim: skipped retry kept, note `skipped: ...`); trace of pipeline.ts:97 and figma.ts judge() confirms it. Not re-run.

leave open: a skipped retry verdict (0 flags) beats a judged, gate-failing first attempt (correctness review, must-fix 1). Reproduced, but it needs the retry's 3 judge votes to all fail right after the first judge worked, which is rare. Harm is a mild one: the retry was regenerated with the judge's problems, so it is not known to be worse, and the note reads `skipped: <err>`, so the user sees the image went unchecked. The fix is a defensive check; nothing shows it's needed.
  Cheapest fix if wanted: `const keepRetry = !v2.skipped && v2.flags.length <= v1.flags.length;` (test: verdicts [bad, skipped] expects first kept).

your call: count all flags vs gate first (correctness review, consider 1). Real: a retry that clears the gate but has extra non-gate flags loses and the note says `needs review: invented`. Harm: an image the judge rated worse on the gate that triggered the retry is kept, with a visible note. Any fix changes a spec rule ("fewer flags"): compare `fail` first, then flag count. That is a design change, so the user decides (or cut: always keep the retry).

## For the fixer
nothing.
## For the user
- Compare gate result before flag count in keepRetry? (new rule; spec says fewer flags)
## For the PR's open findings
- Skipped retry verdict can replace a judged failing first attempt; note says `skipped`. Fix: `!v2.skipped &&` in pipeline.ts:97.
## Dismissed
none
