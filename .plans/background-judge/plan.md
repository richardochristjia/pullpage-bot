# Background judge — spec (Tier M)

## Problem
The agy clean step invents scenery outside the card art window (rain, night, pagodas, smears) instead of extending it. Fill then extends that invented scene, and Figma lays the original card on top, so the background breaks at the card edge. All three Umbreon runs (output/76a803fa…, d25ff5bc…, 29c124a1…) drifted. The only check today is OCR for text (`src/lib/engines/agy.ts` `editImage`).

## Solution
- New `CLEAN_PROMPT` that pins the extension to the art window (text below, verbatim). Probe: one agy call on Umbreon kept tile scale and colors and invented nothing.
- A Claude judge after each clean and after each format's fill. Each judge = 3 parallel `claude -p --model sonnet --allowedTools Read` calls answering a true/false checklist; per-check majority (2 of 3).
  - Clean judge: input is one PNG with the resized original card (left) and the cleaned card (right), each 750×1050, 32px gap. Checks `invented, color, scale, smear`. **Fails when `invented` is the majority.**
  - Final judge: input is the background with every original card composited at `cardRect(format, cell)`, as (a) full frame shrunk so the long side is ≤1200px and (b) a crop of each card rect plus 300px margin on every side (clamped to canvas). Checks `seam, scale, smear`. **Fails when `scale` is the majority.**
  - Single 1–10 scores were dropped: probe showed the same image scored 9 then 3.
- On a fail: rerun that agy step once with `avoid` = the judge's problems (deduped, max 5, each ≤200 chars), appended to the instruction as ` Avoid: <p1>; <p2>.`. Judge the retry. Keep the attempt with fewer majority flags (tie → the retry). If the kept one still fails, the run continues and the check step note says `needs review: <flags>`.
- Judge errors never fail the run: a vote that throws or can't be parsed counts as no flags and no problems; if all 3 votes fail the check is `skipped: <last error>` and counts as a pass.
- Each check is its own step: `clean card N check`, `${format} check`, status `done`, with a note in the existing `error` field of the step (shown by the UI even when done). Notes: `pass`, `pass after retry`, `needs review: invented`, `skipped: …`.

### CLEAN_PROMPT (verbatim)
> Create a new image from in.png using only the illustration inside the card's art window. Extend that illustration outward in every direction so it fills the whole canvas edge to edge, keeping the main subject at the same position and size. The extension must look like more of the same scene: keep the art window's exact color palette, brightness, lighting, weather and time of day, and continue its surfaces with the same objects, scale, perspective and art style across the window edges. Do not add rain, fog, night, buildings or any scenery that the art window does not already show. The trading card itself must not appear: no border, frame, boxes, icons, and no text, letters or numbers of any kind. The output is a clean, text-free artwork.

### Judge prompts (verbatim, `{files}` replaced with the PNG names in the work dir)
Clean: `Read ./{a}. Left: a trading card. Right: an image generated to extend ONLY the illustration in the card art window outward to fill the canvas. Look first at what the art window itself shows, then at what the right image adds outside that area. Answer each question with true or false:` then lines `invented: the added area shows scenery the art window does not (new sky, buildings, weather, night, landscape)` / `color: the added area clearly shifts color, brightness or lighting from the art window` / `scale: objects continued from the art window change size or perspective` / `smear: any region is smeared, melted, blurry or nonsensical`, then `Reply with only JSON: {"invented": bool, "color": bool, "scale": bool, "smear": bool, "problems": ["..."]}.`

Final: `Read ./{full} (full print insert) and ./{crop…} (zoom on each trading card and the background around it). The background was generated to extend the illustration inside the card art window outward. Answer each question with true or false:` then `seam: at the edges of the card, the background does not read as a continuation of the art window (colors, lighting, surfaces or lines break)` / `scale: objects continued from the art window are clearly a different size or perspective outside the card` / `smear: any background region is smeared, melted, blurry or nonsensical`, then `Reply with only JSON: {"seam": bool, "scale": bool, "smear": bool, "problems": ["..."]}.`

## Files
- `src/lib/engines/types.ts` — new `CLEAN_PROMPT`; `clean`/`fill` take optional `avoid?: string[]`; `Engines.judge(kind: "clean" | "final", pngPaths: string[], cwd: string) => Promise<Verdict>`; export `Verdict = { fail: boolean; flags: string[]; problems: string[]; skipped?: string }`.
- `src/lib/engines/agy.ts` — `editImage` appends ` Avoid: …` to the instruction when `avoid` is non-empty; OCR retry logic unchanged.
- `src/lib/engines/figma.ts` — `runClaude` gains optional `{ model, tools, cwd }` (defaults keep `haiku` + Figma tools, existing callers unchanged). New exported `judge(kind, paths, cwd, claude = runClaude)` running 3 votes in parallel via `Promise.allSettled`, parsing with `extractJson`, majority per check, `fail` per the gate above. 120s timeout per vote.
- `src/lib/imaging.ts` — `cleanPair(orig, clean)` and `finalPreviews(format, bg, cards: {cell, png}[])` returning `{ full, crops[] }` buffers.
- `src/lib/pipeline.ts` — clean loop and per-format fill loop run engine → write previews to `.work/<id>/` → `engines.judge` → maybe retry with `avoid` → keep best; emit the check steps with notes. Only the kept image flows on (clean frame, canvas, Figma).
- `src/lib/runs.ts` — `defaultEngines` wires `judge`.
- `src/app/page.tsx` — step row shows `s.error` as a muted note when the step is done (failed rows unchanged).
- `README.md` — one line under "Run time and limits": the two checks, ~10–15s each, and that a failed check costs one more agy call.

## Acceptance criteria
1. The agy prompt for clean contains the new `CLEAN_PROMPT` text. Check: agy.test.ts asserts the spawned prompt.
2. A check that passes leads to exactly one agy call for that step. Check: pipeline.test.ts call counts.
3. A failing check leads to one retry whose instruction contains `Avoid: ` and the judge's problems. Check: agy.test.ts (prompt text) + pipeline.test.ts (`avoid` passed).
4. After a retry, the attempt with fewer flags is the one passed on (tie → retry). Check: pipeline.test.ts inspects the bg handed to `figma` and cleaned handed to `cleanFrame`.
5. Two failing attempts still finish the run with a `needs review` note on the check step. Check: pipeline.test.ts.
6. A judge whose 3 votes all throw finishes the run with a `skipped` note. Check: pipeline.test.ts + figma.test.ts.
7. Majority is 2 of 3; an unparseable vote counts as no flags. Check: figma.test.ts with a fake `claude`.
8. Final preview long side ≤1200px; each crop contains its card rect plus 300px margin (clamped). Check: imaging.test.ts.
9. `npm test`, `npm run lint`, `npm run build` pass.
10. manual: re-run "Umbreon Ketinggalan" (toploader, cell 4) on a Mac with agy and Claude logged in; the background continues the card's pink-eave roof without a break and both check steps show notes.

## Risks
- New prompt proven on one card only; other cards may still drift → the clean judge catches invented scenery and retries once.
- Judge rules come from 4 cleans and 3 frames; borderline images may flip → worst case is one extra agy call or a `needs review` note, never a failed run.
- Each failed check costs one agy call (Pro image quota) — up to doubling agy calls for a bad run.
- Sonnet usage on the user's Claude plan: 3 calls per check.

## Test plan
- `src/lib/engines/agy.test.ts` — new CLEAN_PROMPT in spawned prompt; `avoid` appended; no `Avoid:` when empty.
- `src/lib/engines/figma.test.ts` — `judge` majority, unparseable vote, all-throw → skipped, gate per kind, `runClaude` default args unchanged.
- `src/lib/imaging.test.ts` — `cleanPair` size, `finalPreviews` sizes and crop bounds.
- `src/lib/pipeline.test.ts` — fakes get a scripted `judge`; cases: pass first try, fail→pass, fail twice keeps fewer flags, judge skipped.
- Run: `npm test && npm run lint && npm run build`.
