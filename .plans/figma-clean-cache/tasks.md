## Key and local cache
- [x] Add card key function: sha256(original bytes + CLEAN_PROMPT), 16 hex chars, with unit test
- [x] Add local cache read/write at `<root>/.cache/clean/<key>.png`
- [x] Add `.cache/` to `.gitignore`

## Figma lookup
- [x] Add `findCleans` to `Engines` and `keys?` to `CleanFrameInput` in `src/lib/engines/types.ts`
- [x] Add `buildFindCleansScript` and `findCleans(deps, keys)` in `src/lib/engines/figma.ts` (newest match per key, per-key export failure is a miss)
- [x] Wire `findCleans` in `src/lib/runs.ts` and update every Engines mock

## Pipeline
- [x] Make `check()` report whether the kept result passed
- [x] Reuse branch in the clean loop: local cache, then one Figma lookup for misses (skipped when all hit), fallback to clean on any lookup error
- [x] Emit `reused from cache` / `reused from Figma` and `skipped: reused` notes; write `card<k>.clean.png`
- [x] Cache passing cleans and Figma hits locally; pass keys (passing + reused only) to `cleanFrame`

## Clean frame
- [x] `buildCleanFrameScript` / `publishCleanFrame` name keyed layers `clean<N> #<key>`

## Tests
- [x] Pipeline tests for cases 1–6 in `src/lib/pipeline.test.ts`
- [x] Figma tests for clean frame names and `findCleans` in `src/lib/engines/figma.test.ts`

## Verification
- [x] Second run of same card bytes hits local cache with no clean/judge/findCleans call
- [x] Local miss + Figma hit skips clean/judge, writes cache, notes `reused from Figma`
- [x] Both miss + pass: clean and judge run, cache written, key passed to cleanFrame
- [x] Both miss + needs review: no cache write, no key
- [x] findCleans throwing falls back to cleaning and run succeeds
- [x] Mixed cards: only the new card is cleaned, labels equal planSteps
- [x] Different CLEAN_PROMPT gives a different key
- [x] Clean frame layer names are `clean<N> #<key>` / `clean<N>`
- [x] Find script returns newest node per key, absent keys omitted
- [x] `npm test`, typecheck and build pass
- [x] Record Updates: (1) review the complete implementation; (2a) if it matches the planned Record Updates in plan.md, write those exact entries into `.agents/RECORD.md`; (2b) if it diverged, do not write a wrong entry — surface the divergence in the final summary

## Manual checks
- [ ] manual: Run a card, delete `.cache/`, run the same card again → steps show `reused from Figma`; `.work/<id>/card0.clean.png` is 750×1050 and matches the earlier clean
- [ ] manual: Delete that card's `#<key>` layer in Figma, delete `.cache/`, run again → card is cleaned fresh
