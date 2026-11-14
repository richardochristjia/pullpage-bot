## Prompt
- [x] Replace CLEAN_PROMPT in src/lib/engines/types.ts with the spec's verbatim text
- [x] Add optional `avoid` to clean/fill and append ` Avoid: …` in editImage (src/lib/engines/agy.ts), with agy.test.ts cases

## Judge engine
- [x] Add Verdict type and Engines.judge to src/lib/engines/types.ts
- [x] Give runClaude optional model/tools/cwd, keeping current defaults (src/lib/engines/figma.ts)
- [x] Add judge(kind, paths, cwd, claude) with 3 parallel votes, majority, gates and skip handling, with figma.test.ts cases
- [x] Wire judge into defaultEngines (src/lib/runs.ts)

## Previews
- [x] Add cleanPair and finalPreviews to src/lib/imaging.ts, with imaging.test.ts cases

## Pipeline
- [x] Clean loop: clean, judge, maybe retry with avoid, keep fewer flags, emit `clean card N check` step with note
- [x] Fill loop: fill, judge, maybe retry with avoid, keep fewer flags, emit `${format} check` step with note
- [x] Update pipeline.test.ts fakes with scripted judge and add the four cases

## UI and docs
- [x] Show the step note for done steps in src/app/page.tsx
- [x] Add the README line on checks and retry cost

## Verification
- [x] AC1: clean agy prompt contains the new CLEAN_PROMPT
- [x] AC2: a passing check means exactly one agy call for that step
- [x] AC3: a failing check gives one retry with `Avoid: ` and the judge's problems
- [x] AC4: after a retry the attempt with fewer flags is passed on (tie → retry)
- [x] AC5: two failing attempts finish the run with a `needs review` note
- [x] AC6: all judge votes throwing finishes the run with a `skipped` note
- [x] AC7: majority is 2 of 3 and an unparseable vote counts as no flags
- [x] AC8: final preview long side ≤1200px and crops contain card rect + 300px margin (clamped)
- [x] AC9: `npm test`, `npm run lint`, `npm run build` pass
- [x] Record Updates: (1) review the complete implementation; (2a) if it matches the planned entries, write these exact lines to .agents/RECORD.md — `- (clean) Card cleaning instructs agy to extend only the art window, keeping its colors, lighting, weather, time of day and object scale, with no new scenery.` / `- (clean) Each cleaned card is checked by a majority of three headless Claude votes for invented scenery, and a failing clean is regenerated once with the judge's problems in the prompt.` / `- (background) Each generated background is checked, with the original cards placed on it, by a majority of three headless Claude votes for scale breaks at the card edge, and a failing background is regenerated once with the judge's problems in the prompt.` / `- (pipeline) When a checked step still fails after its retry, the attempt with fewer flags is kept and the run finishes with that step marked as needing review.`; (2b) if the implementation diverged, do not write a wrong entry — report the divergence in the final summary

## Manual checks
- [ ] manual: re-run "Umbreon Ketinggalan" (toploader, cell 4) with agy and Claude logged in; background continues the card's pink-eave roof without a break, and both check steps show notes
