# Falsify: bg-reference-prompt

fix: corrupt ref with allowed MIME passes validateRun, then throws outside step() after clean spent agy quota (review must-fix 1). Reproduced by the reviewer's run (steps: resize, clean card 1, clean check, then throw). Anyone pasting a mislabelled or truncated image hits it; harm is wasted agy calls plus an unlabelled failed run. Cheapest fix: move the `extra` block (pipeline.ts ~138-146) to just after the "resize" step (line 110) and wrap the sharp write in `await step("reference", ...)`. No new rule. Test: runPipeline with bgRef buf "not an image" expects the "reference" step failed and zero clean calls.

dismiss: setBgRef updater side effects leak an object URL under StrictMode (nit 1). Unproven; StrictMode double-invoke is dev-only, leak is one blob URL per paste, freed on page unload. Defensive change, nothing shows it's needed.

leave open: UI accepts any image/* (nit 2). Server returns a clear 400 message; recoverable, looks only. PR line: "paste box accepts any image/*; gif/svg/heic are rejected by the server."

leave open: EXIF rotation ignored for ref (nit 3). Unproven (no run with an EXIF image). If it shows up, the fix is one call: `sharp(buf).rotate()` in both the pipeline and agy writes. PR line: "ref EXIF orientation not applied; unverified."

For the fixer: finding 1 only.
For the user: nothing.
