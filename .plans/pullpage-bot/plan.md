# pullpage-bot — Spec

Tier L: new app, a local server API, three outside programs (Antigravity CLI, Claude Code CLI, Figma MCP).

## Problem

Extending one Pokémon card's art into a binder-sleeve or toploader insert takes about ten manual steps across the Gemini app and Figma: resize the card, ask Gemini to strip text and border, build a blank frame in Figma, paste the cleaned card in the centre, export, ask Gemini to fill the white space, paste the result back as a background, then swap the cleaned card for the original. It is repeated per card and per format.

## Solution

A local web app, `pullpage-bot` (Next.js, same stack as `../pullpage`). The user drops 1 to 3 cards, picks the format(s) and which grid cell each card sits in, and presses Run. The app runs fully automatically and returns one finished frame per format, both as a PNG in `output/` and as a frame in Figma.

| Step | Done by | Detail |
|---|---|---|
| Resize card to 750×1050 | App (`sharp`) | `fit: "fill"` |
| Clean card (remove text, border) | `agy` (Antigravity CLI) on the user's Google AI Pro plan | One call per card, $0 |
| Build white canvas with cleaned cards in their cells | App | Binder 2252×3152, toploader 2702×3602 |
| Fill background | `agy` on Pro | One call per format, $0, output 896×1200 |
| Upscale background to canvas size | App | Lanczos via `sharp` |
| Build Figma frame, layer images, export | Headless Claude (Haiku) on Figma MCP | Page `Automation`, frame `output_<name>_<format>` |
| Show result | App | PNG in `output/<runId>/`, Figma link |

## Phases

1. **Geometry and image maths** — cell positions for both formats, resize, pad to 3:4, scale and crop back, JPEG-under-limit. Pure functions, unit tested.
2. **Engines** — clean pass and background pass through `agy` (API keys stripped from its environment). Behind an interface so tests use fakes.
3. **Figma step** — headless Claude creates the page, frame and layers and returns upload URLs; the app POSTs the images; a second headless call returns the export URL; the app downloads the PNG.
4. **Run pipeline and server API** — one run at a time, step-by-step progress, clear error on any failed step, nothing written to `output/` unless the run succeeds.
5. **Screen** — drop zone for 1 to 3 cards, format picker (binder, toploader, both), 3×3 cell picker per card, run name, progress list, result preview with download and Figma link.
6. **README** — setup: `npm i`, `agy` login, Claude Code with the Figma plugin logged in, `FIGMA_FILE_KEY`.

## Dialectical Outcomes (Why)

- **Figma via a headless Claude agent, not local-only composition or a Figma plugin.** The user chose to keep Figma in the loop. Figma's REST API cannot create frames or place images; Figma MCP can, and it is only callable from an agent. Probe: `claude -p ... --model haiku` reached Figma MCP in 4s for $0.009; the same call on Fable cost $0.66, so the Figma step is pinned to `--model haiku`.
- **Images via `agy` on the Pro plan, not the Gemini API.** User has Google AI Pro and wants no billing setup. The Gemini API key on hand is Free Tier with image quota 0 (`limit: 0 input tokens per minute on Free Tier`). Gemini CLI stopped serving Pro users on 2026-06-18; `agy` is the replacement and bills against the Pro subscription when no API key is in its environment. Rejected: Gemini API at 4K (option B, needs billing), browser automation of the Gemini web app (fragile, account risk).
- **Accepted trade-off:** `agy` returns 896×1200 regardless of the requested size, so the background is upscaled ~2.6× and is softer than the user's manual 3060×4096 backgrounds. The original card is placed on top at native 750×1050, so only the surround is soft.
- **`gemini-4-hydrogen` is text-only**; the user's "Gemini Hydrogen Thinking High" in the app delegates images to an image model. `agy` picks its own image model (probe reported `imagen-3.0-generate-002`); we do not control it.
- **Pad to 3:4 before every image call.** Image models output fixed ratios (no 5:7). A 3:4 input maps back to its box exactly by resize + crop, so the centre art stays where it was.
- **Connecting cards: one clean call per card**, then one background call for the whole canvas. Cleaning several cards in one call risks the model moving them.
- **Fully automatic, no review gates** (user choice). A bad result means rerunning.
- **One card set per run, one frame per format.** 1–3 cards, each in a user-picked cell of the 3×3 grid.
- **Figma target:** a page named `Automation` in file `Zgh77OkLI5fcGcjx0VMKHG` (`Testing`), created on first run, so automation never touches the user's manual frames on `Page 1`.
- **Final PNG = Figma export** (approved plan). Probe: export of a 2252×3152 frame came back exactly 2252×3152, card region mean abs diff 0.17 vs source.

## Relevant Files (Where)

Repo root: `/Users/167560.KEVIN/Development/Richardo/pullpage-bot` (fresh git repo, one commit with `.gitignore`).

| File | Purpose |
|---|---|
| `package.json` | `next@16.2.11`, `react@19.2.4`, `react-dom@19.2.4`, `sharp`, dev: `typescript`, `@types/*`, `vitest`. Scripts `dev`, `build`, `test` (`vitest run`), `lint` (`tsc --noEmit`) |
| `tsconfig.json`, `next.config.ts` | Standard Next app-router setup; `serverExternalPackages: ["sharp"]` |
| `.env.example` | `FIGMA_FILE_KEY=Zgh77OkLI5fcGcjx0VMKHG` |
| `src/lib/geometry.ts` | Formats, canvas sizes, cell → card rect |
| `src/lib/imaging.ts` | `toCard`, `padTo34`, `unpadFrom34`, `composeCanvas`, `jpegUnder` |
| `src/lib/engines/agy.ts` | `agyEnv`, `runAgy`, `cleanCard`, `fillBackground` |
| `src/lib/engines/figma.ts` | `buildFrameScript`, `runClaude`, `publishToFigma` |
| `src/lib/engines/types.ts` | `Engines` interface |
| `src/lib/pipeline.ts` | `validateRun`, `runPipeline` |
| `src/lib/runs.ts` | In-memory run store, single-run lock |
| `src/app/api/runs/route.ts` | `POST` start run |
| `src/app/api/runs/[id]/route.ts` | `GET` run status |
| `src/app/api/runs/[id]/image/route.ts` | `GET ?format=` final PNG |
| `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` | Screen |
| `src/lib/*.test.ts` | Unit tests (see Test Strategies) |
| `README.md` | Setup and use |
| `.agents/RECORD.md` | Written in Verification |

## Key Code Context (What)

No existing code. These are the probed, working shapes the implementation must reuse.

**`agy` headless image edit (probe, worked twice, ~2–4 min each):**
```sh
env -u GEMINI_API_KEY -u GOOGLE_API_KEY agy -p "<instruction naming ./in.png and ./out.png>" \
  --mode accept-edits --sandbox --print-timeout 280s < /dev/null
# cwd = folder holding the input; agy writes the output file there.
# Output observed: 896x1200 PNG for a 3:4 input.
```
Probe prompt wrapper that worked: `Use your image generation tool to edit the image ./<in> with this instruction, then save the result in this folder as <out>, and reply with the saved path. Do not use any API key. Do not upscale the result yourself. Instruction: <PROMPT>`

**Prompts (verbatim from the user):**
```ts
export const CLEAN_PROMPT = "Remove Text, Border, and everything aside from the art in the middle picture, and extend it but not, move the middle picture position at all. don't forget remove ALL TEXT ELEMENT (NUMERICAL,SYMBOL,ALPHABETICAL)";
export const FILL_PROMPT = "fill the white blank space with relevant arts extending from the center image background. Blend everything seamlessly so the whole canvas feels like one complete artwork, with no visible border between the center art and the new background.";
```
Append to FILL_PROMPT: ` Do not move, resize or redraw the existing art.`

**Headless Claude on Figma MCP (probe):**
```sh
claude -p "<prompt>" --model haiku \
  --allowedTools "mcp__plugin_figma_figma__create_session,mcp__plugin_figma_figma__use_figma,mcp__plugin_figma_figma__upload_assets,mcp__plugin_figma_figma__download_assets" \
  --output-format json < /dev/null
# stdout JSON: { result: string, total_cost_usd, ... }
```

**Figma Plugin API script that worked (probe), to embed and pass verbatim to `use_figma`:**
```js
const frame = figma.createFrame();
frame.name = "probe_binder"; frame.resize(2252, 3152);
frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]; frame.clipsContent = true;
const bg = figma.createRectangle(); bg.name = "background"; bg.resize(2252, 3152);
frame.appendChild(bg); bg.x = 0; bg.y = 0;
const card = figma.createRectangle(); card.name = "card"; card.resize(750, 1050);
frame.appendChild(card); card.x = 751; card.y = 1051;
return { frameId: frame.id, bgId: bg.id, cardId: card.id };
```
Rules from the Figma skill: switch pages only with `await figma.setCurrentPageAsync(page)`, once per call; top-level code with `return`, no IIFE; colours 0–1.

**Figma upload (probe):** `upload_assets({ fileKey, count, nodeIds, currentPageId })` returns `uploads[].submitUrl` (single-use, 10 min). App POSTs `multipart/form-data` field `file`. Response `{"success":true,"imageHash":...}` or `{"success":false,"error":"Asset too large (max 10MB)"}`.

**Figma export (probe):** `download_assets({ fileKey, nodeId })` returns `export.url` (short-lived PNG, full node size).

## Implementation Algorithm (How)

### Geometry (`geometry.ts`)
```ts
type Format = "binder" | "toploader";
CANVAS = { binder: { w: 2252, h: 3152 }, toploader: { w: 2702, h: 3602 } };
// cell index 0..8, row-major: col = i % 3, row = floor(i / 3)
cardRect("binder", i)    = { x: col*751,       y: row*1051,       w: 750, h: 1050 }
cardRect("toploader", i) = { x: col*901 + 75,  y: row*1201 + 75,  w: 750, h: 1050 }
```
Check: binder centre (4) = (751,1051); toploader centre = (976,1276).

### Imaging (`imaging.ts`)
- `toCard(buf)` → 750×1050 PNG, `fit: "fill"`.
- `padTo34(buf, w, h)` → `{ buf, box }`: if `w/h < 3/4` pad width to `round(h*3/4)`, else pad height to `round(w*4/3)`; pad split evenly (left gets floor), white. `box = { left, top, w, h, pw, ph }`.
- `unpadFrom34(buf, box)` → resize to `pw×ph` (`fit: "fill"`, lanczos3) then `extract({ left, top, width: w, height: h })`.
- `composeCanvas(format, items: {cell, png}[])` → white canvas at `CANVAS[format]` with each png composited at `cardRect`.
- `jpegUnder(buf, maxBytes = 9.5MB)` → JPEG at quality 92, step down by 6 to 60 until under; throw if still over.

### Engines (`engines/agy.ts`, `engines/types.ts`)
```ts
interface Engines {
  clean(inPng: string, outPath: string): Promise<void>;      // file paths
  fill(inPng: string, outPath: string): Promise<void>;
  figma(input: FigmaInput): Promise<{ url: string; pngPath: string }>;
}
```
- `agyEnv(env)` returns a copy of env without `GEMINI_API_KEY` and `GOOGLE_API_KEY`.
- `runAgy(cwd, prompt, timeoutMs = 300_000)`: `spawn("agy", ["-p", prompt, "--mode", "accept-edits", "--sandbox", "--print-timeout", "280s"], { cwd, env: agyEnv(process.env), stdio: ["ignore","pipe","pipe"] })`. Kill on timeout. Reject with stderr tail on non-zero exit.
- After `runAgy`, the expected output file must exist and decode with `sharp`; otherwise throw `"<step>: agy returned no image"`.
- `clean(card750)`: pad to 3:4 (788×1050) → write `in.png` in a fresh work subdir → agy → `unpadFrom34` → 750×1050.
- `fill(canvas)`: pad canvas to 3:4 (binder 2364×3152, toploader 2702×3603 — use `padTo34` result) → agy → `unpadFrom34` to canvas size.

### Figma (`engines/figma.ts`)
- `buildFrameScript({ name, format, cards: {cell, label}[] })` returns plugin JS string that:
  1. finds page named `Automation` in `figma.root.children`, else `figma.createPage()` with that name;
  2. `await figma.setCurrentPageAsync(page)`;
  3. places a new frame at `x = max(child.x + child.width) + 200` (0 if empty), `y = 0`;
  4. frame `output_<name>_<format>`, canvas size, white fill, `clipsContent = true`;
  5. rectangle `background` at (0,0) canvas size, appended first (back);
  6. one rectangle per card at `cardRect`, named the card label, appended after;
  7. returns `{ pageId, frameId, bgId, cardIds: [...] }`.
- Call 1 (`runClaude`): prompt tells Haiku to `create_session` (fileKey), run `use_figma` with the script verbatim, then call `upload_assets` with `count = 1 + cards`, `nodeIds = [bgId, ...cardIds]`, `currentPageId = pageId`, and reply with ONLY JSON `{ "pageId", "frameId", "uploads": [{ "nodeId", "submitUrl" }] }`.
- App parses `result` (strip code fences, `JSON.parse`); validates node IDs match; POSTs `background.jpg` (from `jpegUnder`) and each original card PNG to the matching `submitUrl`; every response must be `success: true`.
- Call 2: Haiku calls `download_assets({ fileKey, nodeId: frameId })` and replies ONLY JSON `{ "exportUrl" }`. App downloads to the run work dir; checks size equals `CANVAS[format]`.
- Figma link: `https://www.figma.com/design/<fileKey>/?node-id=<frameId with ":" → "-">`.
- `runClaude` timeout 180 s, `env` unchanged, `--model haiku`.

### Pipeline (`pipeline.ts`)
```
validateRun(input) → errors[]   // before any engine call
  cards: 1..3, each png/jpeg/webp, ≤ 25MB
  cells: one per card, ints 0..8, unique
  formats: non-empty subset of {binder, toploader}, no duplicates
  name: [a-z0-9_-]{1,40} after slugifying; default from first file name
  FIGMA_FILE_KEY set

runPipeline(run, engines, onStep):
  steps: resize → clean card k (each) → for each format: canvas → background → upscale → figma → save
  1. originals = cards.map(toCard)                      // 750x1050
  2. cleaned  = for each card: engines.clean(...)        // once per card, shared by both formats
  3. for each format:
       canvas = composeCanvas(format, cleaned at cells)
       bg     = engines.fill(canvas) → exact canvas size
       { url, pngPath } = engines.figma({ format, name, bg, originals, cells })
       collect results
  4. on full success only: copy each pngPath to output/<runId>/output_<name>_<format>.png
  Any throw: step marked failed with message prefixed by step name; run status "failed"; nothing copied.
```
Work files live in `.work/<runId>/`, kept on failure for debugging.

### Server API
- `POST /api/runs` multipart: `cards` (File[]), `cells` (JSON int[]), `formats` (JSON string[]), `name` (string). 400 with `{ errors }` on invalid; 409 if a run is active; 202 `{ id }`. Runs `runPipeline` without awaiting.
- `GET /api/runs/[id]` → `{ id, status: "running"|"done"|"failed", steps: [{ label, status, error? }], results: [{ format, figmaUrl }] }`; 404 unknown.
- `GET /api/runs/[id]/image?format=binder` → PNG from `output/`; 404 if missing.
- Run store: module-level `Map` + one `activeId` (shortcut: in-memory, lost on restart; upgrade if runs must survive restarts).

### Screen (`page.tsx`, client component)
Drop zone (max 3, thumbnails, remove) · per card a 3×3 cell picker (taken cells disabled; default first card → 4, next 5, next 3) · format toggles (binder, toploader; default binder) · name input · Run button (disabled while invalid or running) · progress list polling `GET` every 2 s · on done: preview image per format, Download link, "Open in Figma" link · on fail: failing step and message, Run again.

## Anti-Goals (Out of Scope)

- Review/approve gates or regenerate buttons per step.
- Batch queues, more than one active run, history across restarts, a database.
- Sliced per-cell PNGs, zip downloads.
- Gemini API / billing path, 4K backgrounds, AI upscalers.
- Hosting or multi-user use; the app runs only on this Mac.
- Editing the user's existing frames on `Page 1`; the hidden BORDER/LOGO template layers.
- Choosing the image model `agy` uses.

## Edge Cases & Gotchas

- `agy` ignores requested size; always 896×1200 for 3:4. Never trust its size: always resize back with `unpadFrom34`.
- `agy` may "succeed" without writing the file, or write a different name/extension. Check the exact path; also accept the same basename with `.jpg`/`.jpeg`/`.webp`; else fail.
- `agy` falls back to paid API billing if `GEMINI_API_KEY`/`GOOGLE_API_KEY` is in its env. Always use `agyEnv`.
- `agy` cleaned art comes back slightly enlarged; the original card covers it, so a faint seam at card edges is possible. Accepted.
- Figma upload limit 10MB: a full-size PNG background (17.9MB) was refused. Background always goes as JPEG via `jpegUnder`. Card PNGs (~1.7MB) go as PNG.
- Figma upload URLs are single-use and expire after 10 minutes: POST immediately after call 1.
- Figma page removal fails unless another page is current; we never remove pages.
- Figma `use_figma`: no `figma.notify`, no `figma.currentPage =`, page context resets per call.
- Headless Claude may wrap JSON in prose or code fences; extract the first `{...}` block and validate shape; one retry on parse failure, then fail.
- Haiku must be pinned: a default-model call cost 70× more.
- Toploader canvas 2702×3602 is already ~3:4 (pads 1px height); binder pads 56px each side.
- Both formats in one run: clean once per card, background once per format.
- Run time ~6–10 minutes per card set; UI must show progress, not hang.
- `sharp` must be a server external package in Next config.

## Navigation Anchors

- `runPipeline` in `src/lib/pipeline.ts` — the whole flow.
- `cardRect` in `src/lib/geometry.ts` — every placement.
- `runAgy` / `agyEnv` in `src/lib/engines/agy.ts` — image engine boundary.
- `publishToFigma` / `buildFrameScript` in `src/lib/engines/figma.ts` — Figma boundary.
- `POST` in `src/app/api/runs/route.ts` — entry from the screen.

## Dependency Mappings

- New npm: `next@16.2.11`, `react@19.2.4`, `react-dom@19.2.4`, `sharp`, dev `typescript`, `@types/node`, `@types/react`, `vitest`.
- External programs (must be on PATH, logged in): `agy` (≥1.5.8, Google AI Pro account), `claude` (Claude Code with the Figma plugin MCP `plugin_figma_figma` authenticated).
- Config: `FIGMA_FILE_KEY` in `.env.local`.
- Internal: `pipeline` → `geometry`, `imaging`, `engines/*`; API routes → `pipeline`, `runs`.

## Acceptance Criteria

Automated:
1. Binder cells sit at 751px and 1051px steps; toploader card sits 75px inside its 900×1200 cell (centre = 976,1276). — `geometry.test.ts`
2. Any input image comes out 750×1050. — `imaging.test.ts`
3. A background of 896×1200 comes out at the exact canvas size (2252×3152 or 2702×3602). — `imaging.test.ts`
4. Final canvas is exactly 2252×3152 or 2702×3602. — `pipeline.test.ts` with fakes
5. With fake engines, the original card is pixel-identical in its chosen cell in the final PNG. — `pipeline.test.ts` (fake figma composes locally: background + originals at `cardRect`)
6. More than 3 cards, zero cards, or two cards on one cell are rejected before any engine call. — `pipeline.test.ts`
7. `agy` is started without `GEMINI_API_KEY` or `GOOGLE_API_KEY`. — `agy.test.ts` on `agyEnv` and on the spawn args/env
8. Background sent to Figma is under 10MB. — `imaging.test.ts` on `jpegUnder`
9. `agy` returning no image file stops the run and names the step; nothing is written to `output/`. — `pipeline.test.ts`
10. `npm run build`, `npm run lint`, `npm test` pass.

Manual:
- `manual: Goldeen, binder.` Start `npm run dev`, drop the Goldeen card, cell centre, format binder, Run. Frame `output_goldeen_binder` appears on page `Automation` in `Testing`, background behind, card in centre, no visible seam; PNG in `output/` is 2252×3152.
- `manual: Goldeen, toploader.` Same with toploader; 2702×3602, card at (976,1276).
- `manual: two connecting cards.` Two cards, cells centre and right, binder. One frame, art continuous across both.
- `manual: both formats in one run.` Two frames; progress shows one clean step per card, not per format.
- `manual: print check.` Print one binder insert; user judges whether the upscaled background is acceptable.

## Test Strategies

- **Phase 1:** `src/lib/geometry.test.ts` — all 9 cells both formats, centre values. `src/lib/imaging.test.ts` — `toCard` from 736×1024; `padTo34`→`unpadFrom34` round trip keeps size and centre pixels (feed the padded image itself back, resized to 896×1200, check centre region within small tolerance); 896×1200 → canvas size; `jpegUnder` on a 2252×3152 noise PNG (>10MB) returns < 10MB JPEG.
- **Phase 2:** `src/lib/engines/agy.test.ts` — `agyEnv` strips both keys and keeps others; `runAgy` with an injected spawn fake records args, cwd, env; missing output file throws with the step name.
- **Phase 3:** `src/lib/engines/figma.test.ts` — `buildFrameScript` contains canvas size, `Automation`, all card rects at `cardRect`, background appended before cards; JSON extraction from fenced/prose replies; mismatched node IDs throw.
- **Phase 4:** `src/lib/pipeline.test.ts` — fake engines (`clean` = copy, `fill` = solid colour 896×1200 then real `unpadFrom34`, `figma` = local compose) covering criteria 4, 5, 6, 9, and both-formats call counts (clean ×cards, fill ×2).
- **Phase 5:** `npm run build` compiles the page; no browser walkthrough (no fixture).
- Command: `npm test` (`vitest run`). Real `agy`/Claude/Figma are only exercised by the manual checks.

## Test Cases

| # | Case | Expect |
|---|---|---|
| 1 | Binder, 1 card, centre | Card at (751,1051), canvas 2252×3152 |
| 2 | Toploader, 1 card, centre | Card at (976,1276), canvas 2702×3602 |
| 3 | Binder, 3 cards, middle row (3,4,5) | Cards at x = 0, 751, 1502, y = 1051 |
| 4 | Card input 736×1024 | Output 750×1050 |
| 5 | Pad binder canvas to 3:4, then crop back | Size unchanged, centre pixels unchanged |
| 6 | Background 896×1200 | Upscaled to exact canvas size |
| 7 | 4 cards | Rejected, no engine called |
| 8 | Two cards, same cell | Rejected, no engine called |
| 9 | Clean engine writes no file | Run fails, error names the step, `output/` empty |
| 10 | Background >10MB PNG | JPEG under 10MB |
| 11 | Both formats, 2 cards | `clean` ×2, `fill` ×2, `figma` ×2 |
| 12 | `agy` spawn env | No `GEMINI_API_KEY`, no `GOOGLE_API_KEY` |

## Probe Results

- Headless Claude reaches Figma MCP: Haiku 4s, $0.009; Fable $0.66.
- Figma: create frame + rectangles, upload into rectangles by nodeIds, export → exactly 2252×3152, card pixel-accurate.
- Figma upload limit 10MB; 17.9MB PNG refused, 2.4MB JPEG accepted.
- Deleting a page needs another page current first.
- `gemini-4-hydrogen` cannot output images; Gemini API key is Free Tier with image quota 0.
- `agy -p` headless with keys stripped: clean pass removed all text and border; fill pass seamless; both 896×1200 even when 4K requested; 2–4 min per call; $0.

## Open Risks

- Background softness after 2.6× upscale; only the print check settles it.
- `agy` daily image cap on Pro is unverified (~100/day reported); each run uses cards + formats calls.
- `agy` output naming/behaviour may change between versions.
- Faint seam possible at card edges because `agy` enlarges cleaned art slightly.
- App works only on this Mac (needs `agy`, Claude Code and Figma logins).

## Record Updates

- Create `.agents/RECORD.md` with `/Users/167560.KEVIN/.claude/skills/forge/record-preamble.md` as its body, copied verbatim, followed by:
- (pipeline) A run takes one to three card images and produces one frame per selected format.
- (pipeline) Card images are resized to 750×1050 before any other step.
- (layout) The binder sleeve canvas is 2252×3152 with a 3×3 grid of 750×1050 cells separated by 1px.
- (layout) The toploader canvas is 2702×3602 with a 3×3 grid of 900×1200 cells, each holding a card inset by 75px.
- (clean) Card cleaning is handled by the Antigravity CLI on the user's Google AI subscription, which runs without API keys in its environment.
- (background) Background generation is handled by the Antigravity CLI on the user's Google AI subscription, and the result is upscaled to the canvas size.
- (figma) Frame assembly and export are handled by a headless Claude agent on Figma MCP, which writes to the `Automation` page of the configured Figma file.
- (output) Finished frames are persisted as PNG files to `pullpage-bot/output/`.

## Divergences

- Figma call 1 is not retried (plan said one retry on parse failure for both calls); a retry re-ran the frame-creating script and left a duplicate frame. Call 2 keeps its retry. (falsify C2)
- `toCard` also applies EXIF orientation (`.rotate()`) before resizing; not in the plan. (falsify C3)
- `runAgy` drains agy stdout; not in the plan. (falsify C1)
