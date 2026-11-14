# Correctness review: background-judge (vs link-cut-export)

Based on context-pack.md (read first) plus plan.md, `pipeline.ts`, `figma.ts`, `imaging.ts`. Repro test kept as `review-repro.test.ts.txt` (copy to `src/lib/*.test.ts` to run; not committed).

## must-fix
1. `src/lib/pipeline.ts:97` (context-pack "Do not re-derive" item): `keepRetry = v2.flags.length <= v1.flags.length` lets a skipped retry verdict (flags [] , fail false) win. A judged, gate-failing first attempt is replaced by an unjudged retry, and the note reads `skipped: ...`, hiding that the kept image was never checked. Spec says a skipped check "counts as a pass", but for the first attempt only; nothing says an unjudged retry beats a judged one.
   Proof: temp vitest using the pipeline.test.ts fakes, verdicts `[bad(invented, smear), {skipped:"claude exited 1"}]`. Output: `A note skipped: claude exited 1 mean 255` (red = retry kept; expected first attempt). Fails now.
   Fix: `const keepRetry = !v2.skipped && v2.flags.length <= v1.flags.length;` (note then falls to v1: `needs review: ...`). Test passes with it (mean < 100).

## consider
1. `pipeline.ts:97` flag count includes non-gate flags, as the spec literally says ("fewer majority flags"). Retry that clears the gate but has more other flags loses: verdicts `[invented]` then `{fail:false, flags:[color, smear]}` keeps the first, note `needs review: invented` (observed, mean 127, first kept). Probably against intent (the gate is what triggers the retry); decide whether to compare `fail` first, then flag count.

## noted
1. Clean/final gates, 2-of-3 majority, unparseable vote as no flags, all-throw to `skipped`, retry-throws divergence (`(retry failed: ...)`, first kept): match spec in code.
2. Previews run: binder crops for cells 0/4/8 are 1050x1350, 1350x1650, 1050x1350 (clamped at canvas edges); toploader 1125x1425, 1350x1650, 1125x1425; full is 857x1200 / 900x1200 (long side <= 1200). Three-card composite works.
3. `runClaude` defaults unchanged when `o` omitted (haiku, TOOLS, no cwd key). Judge passes `cwd` = `.work/<id>` (absolute from `process.cwd()`), prompts use `./<basename>` of files written there, so Read resolves. Not exercised against a real `claude` (risks.md).
4. `avoid` only reaches the prompt string; OCR loop untouched.
