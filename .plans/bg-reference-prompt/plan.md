# Background extra prompt + pasted reference image (Tier M)

## Problem

The background fill step (one agy call per format that fills the white space around the placed cards, `src/lib/pipeline.ts` `${format} background` step) always uses the fixed `FILL_PROMPT` in `src/lib/engines/types.ts`. The user cannot steer it with their own words or show it a reference image.

## Solution

- A run carries two optional inputs: `bgPrompt` (text, ≤1000 chars after trim) and `bgRef` (one image: png/jpeg/webp, ≤25MB).
- Every background fill of that run (binder and toploader, first attempt and judge retry) receives both. Clean step and both judges are unchanged.
- `Engines.fill` gains an optional 4th argument `extra?: { prompt?: string; ref?: string }` (`ref` is a file path).
- agy engine: when `extra.ref` is set, copy it into the agy work folder as `ref.png` (convert to PNG with sharp; any input type is fine). The instruction becomes, in this order:
  1. `FILL_PROMPT` (fixed rules stay first and always apply).
  2. If ref: ` Pass ./ref.png to the image generation tool as a second input image; it is a reference only, never copy its text.`
  3. If prompt: ` Additional instruction from the user: <prompt>`
  4. The existing ` Avoid: ...` suffix when present.
  With no extra, the prompt string is byte-identical to today.
- The clean engine must not change: only `fill` accepts/passes `extra`.
- Pipeline writes the reference once per run to `.work/<id>/bg-ref.png` (sharp → png) and passes `{ prompt, ref }` to both `engines.fill` calls (first + retry). Empty prompt and no ref → pass `undefined` (no extra).
- UI (`page.tsx`): next to "run name", a textarea "Background prompt (optional)" and a paste box ("Click, then paste an image (Cmd+V) or drop one"). The box is focusable (`tabIndex=0`), handles `onPaste` (first `clipboardData.items` entry with `type` starting `image/` → `getAsFile()`) and `onDrop`/`onDragOver` (first image file). No `<input type=file>`. Shows a thumbnail (object URL) and a Remove button. `start()` appends `bgPrompt` only when non-blank and `bgRef` only when set.
- Probe (done during planning): agy with `in.png` + `ref.png` in its folder and the line above used the reference's purple starfield as the new background, kept the card art, leaked no ref text; 1 image of quota, 2m26s.

## Files

- `pullpage-bot/src/lib/pipeline.ts` — `RunInput` gets `bgPrompt?: string; bgRef?: { name: string; type: string; buf: Buffer }`; `validateRun` checks ref type (same `TYPES`), size (`MAX_BYTES`), prompt length ≤1000; `runPipeline` writes `bg-ref.png` and passes extra to both fill calls.
- `pullpage-bot/src/app/api/runs/route.ts` — read `bgPrompt` (string, trimmed, `""` → undefined) and `bgRef` (a File when present; a string value → 400 "Bad request."); put both on `input`.
- `pullpage-bot/src/lib/engines/types.ts` — `fill(inPng, outPath, avoid?, extra?: { prompt?: string; ref?: string })`; export a `FillExtra` type.
- `pullpage-bot/src/lib/engines/agy.ts` — `editImage` takes optional extra; copies ref to `<dir>/ref.png`; builds instruction as above. `agyEngines().fill` passes extra through.
- `pullpage-bot/src/app/page.tsx` — the textarea, paste box, thumbnail, Remove, form fields.
- `pullpage-bot/src/lib/engines/agy.test.ts`, `pullpage-bot/src/lib/pipeline.test.ts` — tests below.
- `pullpage-bot/.agents/RECORD.md` — record entries (end of run).

## Acceptance criteria

1. With no `bgPrompt` and no `bgRef`, the agy fill prompt is identical to today and no `ref.png` is written; all existing tests pass unchanged. Check: agy.test + `npm test`.
2. With prompt and ref, the agy folder contains `ref.png` and the prompt contains `FILL_PROMPT`, then the reference line, then `Additional instruction from the user: <text>`, in that order. Check: agy.test.
3. Pipeline passes the same `{ prompt, ref }` to every fill call: both formats and the judge retry (retry also gets `avoid`). Check: pipeline.test.
4. `validateRun` returns an error for a ref that is not png/jpeg/webp, a ref over 25MB, and a prompt over 1000 chars; a run without either is valid as today. Check: pipeline.test.
5. Clean calls never receive extra and their prompt is unchanged. Check: agy.test/pipeline.test.
6. `npm test` and `npm run build` pass.
7. manual: Copy an image to the clipboard, click the paste box, press Cmd+V — thumbnail appears; Remove clears it; dropping an image on the box also works.
8. manual: Run 1 card, toploader, with a reference and a prompt — background visibly follows the reference and the run finishes.

## Risks

- A reference that asks for scenery unlike the card art may trip the background judge's seam check → step marked "needs review"; expected, run still finishes.
- Reference image with text could leak text → existing OCR check retries once, then fails the run (same as today).
- Pasting non-image clipboard content → ignored, box stays empty.
- agy may ignore the reference on some calls → output just looks like a normal fill; no failure.

## Test plan

- `src/lib/engines/agy.test.ts`: fill without extra (prompt unchanged, no ref.png); fill with `{prompt, ref}` (ref.png exists in `<out>.agy/`, prompt order); clean ignores extra.
- `src/lib/pipeline.test.ts`: fake `fill` records its 4th arg; both formats get `{prompt, ref}` with `ref` pointing at an existing file; failing-judge retry gets the same extra; `validateRun` errors for bad type, >25MB, >1000-char prompt.
- Run: `cd pullpage-bot && npm test && npm run build`.
