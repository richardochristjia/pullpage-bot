# Background seam check (Tier M)

## Problem

The background check (`<format> check`) judges only the final preview: the background with the original cards composited on top (`finalPreviews`, `src/lib/imaging.ts:69`; called from `src/lib/pipeline.ts:213`). The card's yellow border hides the boundary between the center art and the fill, so the judge cannot see that agy painted a different scene around the center rectangle (new sky, moon, palette). Also only `scale` gates the final verdict (`JUDGE_RULES.final.gate`, `src/lib/engines/figma.ts:112`), so a `seam` majority never fails the check. All three umbreon XY96 runs (281ada3d, 2a375216, 2abf6854) passed with zero flags while their raw `*.bg.png` show a hard rectangle and a scene break.

## Solution

- `finalPreviews` also returns `raw`: the background alone (no cards), resized like `full` (long side ≤ `FULL_MAX` 1200, `fit: "inside"`, `withoutEnlargement`).
- Pipeline writes it as `${format}.raw${tag}.png` in the work dir and passes judge files in this order: `[full, raw, ...crops]`.
- Final judge prompt: `./<full>` is the full print insert, `./<raw>` is the raw fill with no cards, the rest are crops. The `seam` question is asked of the raw image, with the probed wording: "in the raw fill, the middle rectangle is visible as a separate picture (hard edge, or the colors, lighting, sky or scenery change across its border)". `scale` and `smear` stay as they are (judged on the full/crops).
- Gates become a list: `JUDGE_RULES.clean.gates = ["invented"]`, `JUDGE_RULES.final.gates = ["seam", "scale"]`; `fail = flags.some(f => gates.includes(f))`.
- The existing `check` flow is unchanged: a fail regenerates once with the judge's problems as `avoid`, keeps the attempt with fewer flags, and a persistent fail ends `needs review`.
- No change to the fill prompt or fill input (user chose detection only).

## Files

- `src/lib/imaging.ts` — `finalPreviews` returns `{ full, raw, crops }`.
- `src/lib/pipeline.ts` — write `${format}.raw${tag}.png`, pass `[full, raw, ...crops]` to `engines.judge("final", ...)`.
- `src/lib/engines/figma.ts` — `JUDGE_RULES` gate → `gates` list; final prompt names the raw file and asks `seam` of it.
- `src/lib/imaging.test.ts` — assert `raw` size (long side ≤ 1200, same size as `full`, no card pixels).
- `src/lib/engines/figma.test.ts` — update "only scale gates" test: seam majority now fails; smear-only still passes; clean `color`-only still passes; prompt names full, raw and crops.
- `src/lib/pipeline.test.ts` — mock `judge` records paths; assert final judge gets `binder.full.png`, `binder.raw.png`, crops, and `binder.raw2.png` on retry; a seam fail verdict triggers a second fill with `avoid`.
- `.agents/RECORD.md` — amend the background check entry (Verification phase).

## Acceptance criteria

1. `npm test` passes (`vitest`).
2. `npm run build` passes.
3. Final judge receives the raw preview between the full preview and the crops (pipeline test).
4. `seam` with 2 of 3 votes gives `fail: true` for `final` (figma test); with the existing `check`, that triggers one retry fill with the problems as `avoid` and ends `needs review` if the seam persists (pipeline test).
5. `scale` majority still fails; `smear`-only still passes (figma test).
6. Clean judge still fails only on `invented` (figma test).
7. `manual:` rerun umbreon XY96 (one format) from the run form; the `<format> check` step shows `needs review: seam…` instead of `pass`.
8. `manual:` run a card whose background visibly blends well; its check still passes.

## Risks

- False seam flags on good backgrounds: not probed on a good fill. Effect: such runs end `needs review` and pay one retry fill. Mitigated by manual check 8; adjust the wording if it fires.
- Cost: every seam fail costs one extra agy fill (~2 min, one Pro image). Since the fill almost always leaves a rectangle, most runs will pay it and still end `needs review`.
- Raw file is not added to the work-route allow-list (`src/lib/work.ts`); it is a judge input only, like `full`/`crop`.

## Test plan

- `src/lib/imaging.test.ts` — raw preview shape.
- `src/lib/engines/figma.test.ts` — gates and prompt.
- `src/lib/pipeline.test.ts` — judge file list and seam-triggered retry.
- Run: `npm test` then `npm run build`.

## Probe

One Sonnet vote per raw `bg.png` of the three umbreon runs, with the seam wording above: all three returned `seam: true` (hard edge, sky/moon mismatch, lighting change).

## Record Updates

Replace the entry beginning `- (background) Each generated background is checked, with the original cards placed on it,` with:

- (background) Each generated background is checked by a majority of three headless Claude votes for a visible seam around the center art on the raw fill and for scale breaks at the card edge with the original cards placed on it, and a background that fails either is regenerated once with the judge's problems in the prompt.
