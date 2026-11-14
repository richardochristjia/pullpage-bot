# Reuse cleaned cards (local cache, then Figma)

Tier M. Base branch: `wizard-revamp` (main holds only the init commit; all pipeline code lives on `wizard-revamp`). The PR targets `wizard-revamp`.

## Problem

Every run sends every card to agy to clean (`src/lib/pipeline.ts` clean loop) and then to three Claude judges, even when the exact same card was cleaned before. Cleans are already published to Figma at the end of a run (`clean figma` step, `publishCleanFrame` in `src/lib/engines/figma.ts`) as layers `clean1..N` in a `clean_<name>` frame on the `Automation` page, but those layers carry nothing identifying the source card, so a later run cannot find them.

## Solution

- Each card gets a key: `sha256(original uploaded bytes + CLEAN_PROMPT)`, first 16 hex chars. Changing `CLEAN_PROMPT` invalidates old keys automatically.
- Before cleaning, the clean phase looks up each card in order:
  1. Local file `<root>/.cache/clean/<key>.png`.
  2. For all cards that missed locally, one Figma lookup (`engines.findCleans(keys)`): a `use_figma` script searches the `Automation` page for nodes whose name ends ` #<key>` and returns the newest match per key (newest = last found in page order, i.e. rightmost frame, since new frames are placed to the right). Each hit is downloaded with the existing `exportNode(deps, nodeId, 750, 1050)`, which validates size. A Figma hit is also written to the local cache.
  3. Miss: agy clean + judge check as today.
- Reused card: write the buffer to `.work/<id>/card<k>.clean.png`; emit `clean card N` done with note `reused from cache` or `reused from Figma` (image `card<k>.clean.png`); emit `clean card N check` done with note `skipped: reused`. No `engines.clean` / `engines.judge` call for that card.
- Only cleans that passed the judges are keyed: written to the local cache and given the key in their Figma layer name. `check()` must report whether the kept result passed (verdict not `fail`; a `skipped` verdict counts as not passed — do not cache unchecked cleans). A "needs review" clean gets no key and is regenerated next run. Reused cards count as passed and keep their key.
- `buildCleanFrameScript` takes an optional key per card; keyed layer name is `clean<N> #<key>`, unkeyed stays `clean<N>`. `CleanFrameInput` gains `keys?: (string | undefined)[]`.
- `findCleans` failure (throw, timeout, bad reply, export size mismatch) never fails the run: catch, treat as all-miss (per card, a failed export is a miss for that card only). No extra step label; `planSteps` is unchanged.
- If every card hit locally, skip the Figma lookup call entirely.
- The run still publishes its own clean frame (unchanged behavior; duplicates in Figma are fine, newest wins).
- `.cache/` added to `.gitignore`.

## Files

- `src/lib/pipeline.ts` — key computation, local cache read/write, call `findCleans`, reuse branch in the clean loop, `check()` returns pass flag, pass keys to `cleanFrame`.
- `src/lib/engines/types.ts` — `Engines.findCleans(keys: string[]): Promise<Record<string, Buffer>>`; `CleanFrameInput.keys?`.
- `src/lib/engines/figma.ts` — `buildFindCleansScript({ keys })`, `findCleans(deps, keys)` (one `askJson` call, idempotent so `tries` 2, then `exportNode` per hit); `buildCleanFrameScript` / `publishCleanFrame` accept keys.
- `src/lib/runs.ts` — wire `findCleans: (keys) => findCleans(defaultFigmaDeps(fileKey), keys)`.
- `.gitignore` — add `.cache/`.
- Any other `Engines` mock/implementation that must satisfy the interface (grep `cleanFrame:` in tests).
- Tests: `src/lib/pipeline.test.ts`, `src/lib/engines/figma.test.ts`.

## Acceptance criteria

1. A second run of the same card bytes hits the local cache: no `clean`, `judge`, or `findCleans` call for it; note `reused from cache`. (pipeline test)
2. Local miss + Figma hit: no `clean`/`judge` call; cache file written; note `reused from Figma`. (pipeline test)
3. Both miss + clean passes: clean and judge run; cache written; key passed to `cleanFrame`. (pipeline test)
4. Both miss + clean ends "needs review": no cache write; no key for that card. (pipeline test)
5. `findCleans` throws: card cleaned normally, run succeeds. (pipeline test)
6. Mixed cards (one cached, one new): only the new one is cleaned; emitted labels still equal `planSteps`. (pipeline test)
7. Different `CLEAN_PROMPT` yields a different key for the same bytes. (unit test)
8. `buildCleanFrameScript` names keyed layers `clean<N> #<key>` and unkeyed `clean<N>`. (figma test)
9. Find script returns newest node per key; absent keys omitted. (figma test on script/reply parsing)
10. `npm test`, typecheck and build pass.
- manual: Run a card, delete `.cache/`, run the same card again → steps show `reused from Figma`; `.work/<id>/card0.clean.png` is 750×1050 and matches the earlier clean.
- manual: Delete that card's `#<key>` layer in Figma, delete `.cache/`, run again → card is cleaned fresh.

## Risks

- Exporting a single rectangle node may not return exactly 750×1050 (unprobed). `exportNode` checks size and throws; that card is treated as a miss and cleaned. No wrong output, only lost reuse.
- The Figma lookup adds one headless Claude call (~30–60s) to every run with a local miss. Bounded by the existing `runClaude` timeout; on timeout the run cleans normally.
- A person renaming a layer breaks its match; the card is simply cleaned again.
- Same image re-encoded or in another format has different bytes and gets a different key (accepted).
- Local cache grows unbounded (750×1050 PNGs; accepted, user can delete `.cache/`).

## Test plan

- `src/lib/pipeline.test.ts`: cases 1–6 using fake engines with call counters and a temp `root` (cache lives under `<root>/.cache/clean`).
- `src/lib/engines/figma.test.ts`: case 8 (clean frame script names), case 9 (find script contents and `findCleans` with fake `claude`/`fetch` returning PNGs; export failure for one key drops only that key).
- Key unit test (case 7) next to the key function.
- Command: `npm test` (plus `npx tsc --noEmit` and `npm run build`).

## Record Updates

- (clean) Before cleaning, a run looks up each card by a hash of its uploaded bytes and the clean prompt, first in `.cache/clean/` and then in the `Automation` page's clean layers, and reuses a match without agy or the judges.
- (clean) Only cleans that pass the judges are cached locally and keyed in their Figma layer name, so a needs-review clean is regenerated on the next run.
- (clean) A failed Figma clean lookup falls back to cleaning and never fails the run.
