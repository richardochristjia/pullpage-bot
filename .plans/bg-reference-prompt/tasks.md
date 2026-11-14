## Run input
- [x] Add `bgPrompt` and `bgRef` to `RunInput` and validate them in `validateRun` (type, 25MB, 1000 chars)
- [x] Read `bgPrompt` and `bgRef` from the form in `src/app/api/runs/route.ts`

## Engine
- [x] Add optional `extra` to `Engines.fill` in `src/lib/engines/types.ts`
- [x] In `src/lib/engines/agy.ts`, copy ref to `ref.png` and append the reference line and user text after `FILL_PROMPT` (fill only)

## Pipeline
- [x] Write `bg-ref.png` once per run and pass `{ prompt, ref }` to both fill calls (first and retry)

## UI
- [x] Add background prompt textarea and paste/drop box with thumbnail and Remove in `src/app/page.tsx`; send fields only when set

## Tests
- [x] agy.test: no-extra prompt unchanged, extra writes ref.png and orders prompt, clean ignores extra
- [x] pipeline.test: extra reaches both formats and retry; validateRun errors

## Verification
- [x] AC1: no extra → fill prompt identical, no ref.png, existing tests pass
- [x] AC2: prompt+ref → ref.png present, prompt order FILL_PROMPT, reference line, user text
- [x] AC3: same extra reaches every fill call incl. retry
- [x] AC4: validateRun errors for bad ref type, >25MB, >1000-char prompt; plain run valid
- [x] AC5: clean calls never get extra, prompt unchanged
- [x] AC6: `npm test` and `npm run build` pass
- [x] Record Updates: (1) review the complete implementation; (2a) if it matches the planned entries, append exactly these lines to `.agents/RECORD.md`: `- (background) A run can carry one optional extra prompt and one optional reference image, which every background fill in that run passes to agy after the fixed fill rules.` and `- (background) The background reference image is pasted or dropped into the run form, with no file picker.`; (2b) if the implementation diverged, do not write a wrong entry — surface the divergence in the final summary

## Manual checks
- [ ] manual: copy an image, click the paste box, Cmd+V → thumbnail; Remove clears; drop works
- [ ] manual: run 1 card, toploader, with reference + prompt → background follows reference, run finishes
