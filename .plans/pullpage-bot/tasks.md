## Geometry and image maths
- [x] Scaffold Next.js app (package.json, tsconfig, next.config.ts with sharp external, layout, globals.css, .env.example, vitest)
- [x] Add `src/lib/geometry.ts` (formats, canvas sizes, `cardRect`) with `geometry.test.ts`
- [x] Add `src/lib/imaging.ts` (`toCard`, `padTo34`, `unpadFrom34`, `composeCanvas`, `jpegUnder`) with `imaging.test.ts`

## Engines
- [x] Add `src/lib/engines/types.ts` (`Engines` interface) and prompts
- [x] Add `src/lib/engines/agy.ts` (`agyEnv`, `runAgy` with injectable spawn, `clean`, `fill`, output-file check) with `agy.test.ts`

## Figma step
- [x] Add `buildFrameScript` (Automation page, frame, background then card rects) in `src/lib/engines/figma.ts`
- [x] Add `runClaude` (Haiku, allowed Figma tools, JSON extraction with one retry) and `publishToFigma` (call 1, POST uploads, call 2, download export, size check)
- [x] Add `figma.test.ts` (script content, JSON extraction, node ID mismatch)

## Run pipeline and server API
- [x] Add `src/lib/pipeline.ts` (`validateRun`, `runPipeline` with step reporting, output only on success) with `pipeline.test.ts` using fake engines
- [x] Add `src/lib/runs.ts` (in-memory store, single active run)
- [x] Add `POST /api/runs`, `GET /api/runs/[id]`, `GET /api/runs/[id]/image`

## Screen
- [x] Build `src/app/page.tsx`: drop zone (max 3), per-card cell picker, format toggles, name, Run, progress polling, result preview, download, Figma link, error view

## README
- [ ] Write `README.md` (setup: npm i, agy login, Claude Code + Figma plugin, FIGMA_FILE_KEY; usage; run time; limits)

## Verification
- [ ] AC1: binder cells at 751/1051 steps; toploader card 75px inset, centre (976,1276)
- [ ] AC2: any input image comes out 750×1050
- [ ] AC3: 896×1200 background comes out at exact canvas size
- [ ] AC4: final canvas exactly 2252×3152 or 2702×3602
- [ ] AC5: with fake engines, original card pixel-identical in its cell in the final PNG
- [ ] AC6: >3 cards, 0 cards, duplicate cells rejected before any engine call
- [ ] AC7: `agy` started without `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- [ ] AC8: background sent to Figma under 10MB
- [ ] AC9: `agy` returning no image stops the run, names the step, nothing in `output/`
- [ ] AC10: `npm run build`, `npm run lint`, `npm test` pass
- [ ] Record Updates: (1) review the complete implementation; (2a) if it matches the planned Record Updates in plan.md, create `.agents/RECORD.md` with `/Users/167560.KEVIN/.claude/skills/forge/record-preamble.md` copied verbatim as its body followed by those exact entries; (2b) if the implementation diverged from any planned entry, do not write a wrong entry — surface the divergence in the final summary for the user to resolve

## Manual checks
- [ ] Goldeen, binder: frame `output_goldeen_binder` on page `Automation`, background behind, card centre, no seam, PNG 2252×3152
- [ ] Goldeen, toploader: 2702×3602, card at (976,1276)
- [ ] Two connecting cards (centre, right), binder: one frame, art continuous
- [ ] Both formats in one run: two frames, one clean step per card
- [ ] Print check: upscaled background acceptable in print
