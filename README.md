# pullpage-bot

Local web app that extends 1 to 3 Pokemon cards into a finished binder-sleeve or toploader insert. It cleans each card and fills the background with `agy` (Antigravity CLI), then builds the frame in Figma through a headless Claude agent and saves the exported PNG to `output/<runId>/`.

## Setup

1. `npm i`
2. `agy`: install (1.5.8 or newer) and log in with the Google AI Pro account. Do not set `GEMINI_API_KEY` or `GOOGLE_API_KEY`; the app strips them from `agy`'s environment anyway.
3. Claude Code (`claude`) on PATH with the Figma plugin installed and logged in.
4. `cp .env.example .env.local` and set `FIGMA_FILE_KEY` to the target Figma file.

## Use

`npm run dev`, open http://localhost:3000, drop 1 to 3 cards, pick a grid cell for each, choose binder, toploader or both, press Run.

Output: `output/<runId>/output_<name>_<format>.png` and a frame `output_<name>_<format>` on the `Automation` page of the Figma file.

After a run, press **Cut to Figma**. It builds a cut frame beside the run's frame, with one clipping frame per print piece (the card layers left out, so card cells show background only). Check the pieces in Figma and edit inside them, but don't move them. Then press **Make PDF**: the server re-exports the cut frame, slices it at the fixed piece positions (no AI step) and writes `output/<runId>/<Name> <format>.pdf`, one 300 dpi page per piece in row-major order. Make PDF needs a cut first. Binder pieces are 2.5x3.5 in with card cells skipped; toploader pieces are 3x4 in, all 9. Past runs, including ones from before a restart, are listed on the page and can be cut and made there.

## Run time and limits

- About 6 to 10 minutes per card set; each `agy` call takes 2 to 4 minutes. A run needs one call per card plus one per format.
- One run at a time; run progress is kept in memory and lost on restart, but each finished run keeps a `run.json` in its output folder.
- `agy` returns 896x1200 images, so the background is upscaled and is softer than the cards, which are placed at native size.
- Works only on a Mac with `agy`, Claude Code and Figma logged in.

## Scripts

`npm test`, `npm run lint` (type check), `npm run build`.
