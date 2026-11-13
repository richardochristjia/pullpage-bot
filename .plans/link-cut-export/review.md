# Review: link-cut-export (base cut-to-figma, three-dot)

Source: `.plans/link-cut-export/context-pack.md` (diff, contracts, ACs) and `plan.md`. Four independent reviewers: correctness, security, structure, tests. Suite state (tests reviewer, real runs): `npm test` 66/66 pass, `npm run lint` clean, `npm run build` ok (AC7 holds).

## Intent
Each run also publishes a `clean_<name>` frame. A Links section cuts pasted Figma frame links and exports pasted cut-frame links to PDF, reading format and cells from Figma instead of `run.json`.

## Act on
1. **A binder with cards in all 9 cells is "cut" into an empty frame.** `src/lib/engines/figma.ts:186` skips every piece; `src/lib/links.ts:36` then rejects the empty `cells`, so Export always fails for that link. The old `cut_<name>` is already deleted. Raised by: correctness. Proof: the generated script run against a fake `figma` (scratchpad `p.ts`, `npx tsx p.ts`) printed `9 cards: {"format":"binder","cardCells":[0,...,8]}` with no throw. Fix: throw before removing the old cut when `fmt === "binder" && cardCells.length >= 9`.
2. **AC2 tests don't pin the link cut script.** `src/lib/engines/figma.test.ts` (link cut tests, about lines 175-200) against `figma.ts:150-197`. Raised by: tests. Proof: in a scratchpad copy the card-layer removal was deleted, the tolerance at `figma.ts:174` widened from `<=2` to `<=500`, and the fill and `clipsContent` dropped. `npx vitest run src/lib/engines/figma.test.ts` still gave 16/16 pass. Fix: assert no `card*` children inside pieces, add a card nudged 3px or more that must not count, and assert fill and clip.

## Consider
- **Single Claude call is only tested on parseable replies.** `figma.test.ts` last test; `askJson` at `figma.ts:98-106` retries only on throw. Changing `tries` from 1 to 2 would still pass. The unparseable-reply case is the one that makes duplicate frames. Reasoned, not run. Tests.
- **Routes and 409 mapping untested.** AC5 is tested only on `withLinkLock`. There is no `handleLink` 409 test, and no test of the three routes or the pdf 404/header. No tests exist under `src/app` (grep). Tests.
- **Stale link left in box 2 after a re-cut.** `src/app/page.tsx:94` dedupes by exact string. A re-cut makes a new node id, so the old `cutUrl` stays and its export fails with "frame not found". Not run (needs Figma). Correctness.
- **Re-cut is not atomic.** The old cut is removed before the new one is built, and `cutLinkInFigma` must not retry. A throw in between loses the cut. Correctness.
- **No auth on `/api/links/*`.** Anyone who can reach the server can spend Claude calls and edit the Figma file. Fine if localhost only; bind check not done. Security.
- **Link lock does not cover pipeline runs or run Cut/PDF** (`links.ts:59`, `runs.ts:20`). Two Figma writes could overlap and place frames on top of each other. Not run (needs Figma). Structure, correctness.
- **A card off the grid by 3px or more is silently ignored** (`figma.ts:174-175`). Proven on the fake: `nudge3: cardCells:[]`, `nudge2: [4]`. It is already in risks.md, so only the silent failure is new. Correctness.

## Noted
- **Duplicated code** (structure, nits, proven by grep). The page preamble in `buildCleanFrameScript` repeats `buildFrameScript` (`figma.ts:35-38` vs `:13-16`). The tmp-write-then-rename repeats `approve.ts:74-75` at `links.ts:46-47`.
- **`"status" in r` lock check** (`links.ts:84-87`). It works today; it breaks if a job result gains a `status` field. Structure.
- **User errors map to 500.** "Not a cut frame" and a wrong frame size get 500 where 400 or 422 would fit. Correctness.
- **Pipeline test checks only the count passed to `cleanFrame`.** It does not check the buffers (`pipeline.test.ts`). Tests.
- **AC6 assertion is buried in the export test.** It is a valid guard but not a named test. Tests.
- **Security, unproven nits:**
  - `exportUrl` from Claude is not host-checked (`figma.ts:114`; this was already the case).
  - `cutFrameId` and `cardCells` are returned unvalidated.
  - 500 bodies include the tail of Claude's stderr.
  - A frame name over about 250 characters gives a 500.
- **Orphaned frames after a late pipeline failure.** This follows AC4.
- **Two same-name source frames share `cut_<name>`.** Follows from the naming scheme.

## Dismissed
- **Path traversal** via the pdf route or a PDF file name. `^\d+-\d+$` is anchored, `pdfFileName` strips separators and control characters, and the name always ends in ` <format>.pdf`. Security read these paths; no proof of a hole.
- **Script injection from node id or frame names.** Values go through `JSON.stringify`, and the node id is validated.
- **XSS from `cutUrl`.** `page.tsx` puts it in a textarea, not an `href`.
- **Cut name collision** between `cut_<slug>_<format>` and `cut_output_<slug>_<format>`. Checked, none.
- **Prompt injection through frame names** (security nit). Impact is bounded by Haiku's allowed tools.

## Agreement map
There was no overlap between angles. Security found nothing proven, structure found only nits, and the two real issues came from the angles that ran code (correctness ran the script, tests mutated a copy). The lock-coverage concern was raised by both structure and correctness, but neither could prove it without real Figma.

## Open
Nothing was run against real Figma (not allowed). The risks.md items stay unverified. The unproven suspicions above need a manual check.
