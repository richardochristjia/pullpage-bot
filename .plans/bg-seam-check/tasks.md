## Build
- [x] `finalPreviews` returns `raw` (background only, long side ≤ 1200) and imaging test covers it
- [x] Pipeline writes `${format}.raw${tag}.png` and passes `[full, raw, ...crops]` to the final judge
- [x] `JUDGE_RULES` uses a `gates` list; final gates `seam` and `scale`; final prompt names the raw file and asks `seam` of it
- [x] Update figma judge tests (seam fails, smear-only passes, clean color-only passes, prompt names raw)
- [x] Update pipeline tests (judge file list incl. raw/raw2, seam fail triggers retry fill with avoid)

## Verification
- [x] `npm test` passes
- [x] `npm run build` passes
- [x] Final judge receives the raw preview between full preview and crops
- [x] Seam 2/3 fails the final check, triggers one retry, ends `needs review` if it persists
- [x] Scale majority still fails; smear-only still passes
- [x] Clean judge still fails only on `invented`
- [x] Record Updates: (1) review the complete implementation; (2a) if it matches the planned Record Updates in plan.md, replace the `(background) Each generated background is checked, with the original cards placed on it, …` entry in `.agents/RECORD.md` with the exact planned entry; (2b) if the implementation diverged, do not write a wrong entry — surface the divergence in the final summary

## Manual checks
- [ ] manual: rerun umbreon XY96 (one format); `<format> check` shows `needs review: seam…`
- [ ] manual: run a card whose background visibly blends; its check still passes
