# Context pack

BASE: figma-clean-cache
CHANGED: 7 source files (src + .agents), +35/-18 (plan docs excluded)

## What this change does
The final background check now also shows the judge the raw fill (no cards) and asks `seam` of it. `seam` joins `scale` as a gate, so a seam majority fails the check and triggers the existing one-retry-then-`needs review` flow. No change to fill prompt or input.

## Files
- `src/lib/imaging.ts:69` — `finalPreviews` now returns `{ full, raw, crops }`; raw = bg resized like full (<=1200, inside)
- `src/lib/pipeline.ts:208-214` — final check writes `${format}.raw${tag}.png`, passes `[full, raw, ...crops]` to `engines.judge("final")`
- `src/lib/engines/figma.ts:110-160` — `JUDGE_RULES.*.gate` -> `gates` list; final prompt names raw file, seam asked of raw; `fail = flags.some(gates)`
- `src/lib/imaging.test.ts:75` — raw size and no-card-pixels assertions
- `src/lib/engines/figma.test.ts:273-296` — seam gates, smear-only passes, prompt wording
- `src/lib/pipeline.test.ts:25,200` — fake judge records file basenames; seam-retry test
- `.agents/RECORD.md:68` — background check entry amended

## API contracts
- None over HTTP. Internal: `engines.judge(kind: "clean"|"final", files: string[], cwd)` -> `Verdict {fail, flags, problems}` (`src/lib/engines/figma.ts:136`). Final `files` order is now `[full, raw, ...crops]`; prompt indexes `names[0]`, `names[1]`, `names.slice(2)`.

## Test entry points
- `npx vitest run src/lib/imaging.test.ts src/lib/engines/figma.test.ts src/lib/pipeline.test.ts`
- Full: `npm test`; then `npm run build`

## Acceptance criteria
1. `npm test` passes (`vitest`).
2. `npm run build` passes.
3. Final judge receives the raw preview between the full preview and the crops (pipeline test).
4. `seam` with 2 of 3 votes gives `fail: true` for `final` (figma test); with the existing `check`, that triggers one retry fill with the problems as `avoid` and ends `needs review` if the seam persists (pipeline test).
5. `scale` majority still fails; `smear`-only still passes (figma test).
6. Clean judge still fails only on `invented` (figma test).
7. manual: rerun umbreon XY96 (one format) from the run form; the `<format> check` step shows `needs review: seam…` instead of `pass`.
8. manual: run a card whose background visibly blends well; its check still passes.

## Do not re-derive
- Raw file is a judge input only; not added to the work-route allow-list (`src/lib/work.ts`).
- Clean judge behaviour unchanged (gates `["invented"]`).
- Retry/keep-fewer-flags logic lives in the pipeline check helper, untouched.
- Risk: false seam flags on good fills cost one extra fill (plan Risks).

## Diff
```diff
diff --git a/src/lib/engines/figma.test.ts b/src/lib/engines/figma.test.ts
--- a/src/lib/engines/figma.test.ts
+++ b/src/lib/engines/figma.test.ts
@@ -272,3 +272,3 @@ describe("figma", () => {
 
-    it("final: only scale gates; unparseable and throwing votes count as no flags", async () => {
+    it("final: seam and scale gate; unparseable and throwing votes count as no flags", async () => {
       const claude = seq(vote({ seam: true, scale: true }), async () => "no json", vote({ seam: true, scale: true }));
@@ -277,3 +277,5 @@ describe("figma", () => {
       const seamOnly = await judge("final", ["/w/f.png"], "/w", seq(vote({ seam: true }), vote({ seam: true }), bad) as any);
-      expect(seamOnly).toMatchObject({ fail: false, flags: ["seam"] });
+      expect(seamOnly).toMatchObject({ fail: true, flags: ["seam"] });
+      const smearOnly = await judge("final", ["/w/f.png"], "/w", seq(vote({ smear: true }), vote({ smear: true }), bad) as any);
+      expect(smearOnly).toMatchObject({ fail: false, flags: ["smear"] });
     });
@@ -288,3 +290,3 @@ describe("figma", () => {
       const claude = async (p: string, t: number, _s: undefined, o: any) => (seen.push({ p, t, o }), "{}");
-      await judge("final", ["/w/f.png", "/w/c1.png", "/w/c2.png"], "/w", claude as any);
+      await judge("final", ["/w/f.png", "/w/r.png", "/w/c1.png", "/w/c2.png"], "/w", claude as any);
       expect(seen).toHaveLength(3);
@@ -292,3 +294,4 @@ describe("figma", () => {
       expect(seen[0].t).toBe(120_000);
-      expect(seen[0].p).toContain("Read ./f.png (full print insert) and ./c1.png ./c2.png (zoom");
+      expect(seen[0].p).toContain("Read ./f.png (full print insert), ./r.png (the raw fill: the background alone, no cards) and ./c1.png ./c2.png (zoom");
+      expect(seen[0].p).toContain("seam: in the raw fill, the middle rectangle is visible as a separate picture");
     });
diff --git a/src/lib/engines/figma.ts b/src/lib/engines/figma.ts
--- a/src/lib/engines/figma.ts
+++ b/src/lib/engines/figma.ts
@@ -110,4 +110,4 @@ export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nod
 const JUDGE_RULES = {
-  clean: { checks: ["invented", "color", "scale", "smear"], gate: "invented" },
-  final: { checks: ["seam", "scale", "smear"], gate: "scale" },
+  clean: { checks: ["invented", "color", "scale", "smear"], gates: ["invented"] },
+  final: { checks: ["seam", "scale", "smear"], gates: ["seam", "scale"] },
 } as const;
@@ -125,4 +125,4 @@ ${reply(JUDGE_RULES.clean.checks)}`;
   }
-  return `Read ./${names[0]} (full print insert) and ${names.slice(1).map((n) => `./${n}`).join(" ")} (zoom on each trading card and the background around it). The background was generated to extend the illustration inside the card art window outward. Answer each question with true or false:
-seam: at the edges of the card, the background does not read as a continuation of the art window (colors, lighting, surfaces or lines break)
+  return `Read ./${names[0]} (full print insert), ./${names[1]} (the raw fill: the background alone, no cards) and ${names.slice(2).map((n) => `./${n}`).join(" ")} (zoom on each trading card and the background around it). The background was generated to extend the illustration inside the card art window outward. Answer each question with true or false:
+seam: in the raw fill, the middle rectangle is visible as a separate picture (hard edge, or the colors, lighting, sky or scenery change across its border)
 scale: objects continued from the art window are clearly a different size or perspective outside the card
@@ -141,3 +141,3 @@ export async function judge(
 ): Promise<Verdict> {
-  const { checks, gate } = JUDGE_RULES[kind];
+  const { checks, gates } = JUDGE_RULES[kind];
   const prompt = judgePrompt(kind, paths.map((p) => path.basename(p)));
@@ -159,3 +159,3 @@ export async function judge(
   ].slice(0, 5);
-  return { fail: flags.includes(gate), flags, problems };
+  return { fail: flags.some((f) => (gates as readonly string[]).includes(f)), flags, problems };
 }
diff --git a/src/lib/imaging.test.ts b/src/lib/imaging.test.ts
--- a/src/lib/imaging.test.ts
+++ b/src/lib/imaging.test.ts
@@ -77,2 +77,4 @@ describe("imaging", () => {
     expect(await size(mid.full)).toEqual([857, 1200]);
+    expect(await size(mid.raw)).toEqual([857, 1200]);
+    expect((await sharp(mid.raw).stats()).channels[0].mean).toBeCloseTo(200, 0); // no card pixels
     expect(await size(mid.crops[0])).toEqual([1350, 1650]); // 750+600 x 1050+600
diff --git a/src/lib/imaging.ts b/src/lib/imaging.ts
--- a/src/lib/imaging.ts
+++ b/src/lib/imaging.ts
@@ -67,3 +67,3 @@ export async function cleanPair(orig: Buffer, clean: Buffer) {
 
-// Background with the original cards placed on it: a shrunk full frame plus one crop per card with a margin.
+// Background with the original cards placed on it: a shrunk full frame, the shrunk background alone, and one crop per card with a margin.
 export async function finalPreviews(format: Format, bg: Buffer, cards: { cell: number; png: Buffer }[]) {
@@ -75,2 +75,3 @@ export async function finalPreviews(format: Format, bg: Buffer, cards: { cell: n
   const full = await sharp(placed).resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
+  const raw = await sharp(bg).resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
   const crops = await Promise.all(
@@ -86,3 +87,3 @@ export async function finalPreviews(format: Format, bg: Buffer, cards: { cell: n
   );
-  return { full, crops };
+  return { full, raw, crops };
 }
diff --git a/src/lib/pipeline.test.ts b/src/lib/pipeline.test.ts
--- a/src/lib/pipeline.test.ts
+++ b/src/lib/pipeline.test.ts
@@ -27,2 +27,3 @@ function fakes(verdicts: Verdict[] = []) {
   const judged: string[] = [];
+  const judgedFiles: string[][] = [];
   const cleanFrameArgs: Buffer[][] = [];
@@ -44,4 +45,5 @@ function fakes(verdicts: Verdict[] = []) {
     },
-    async judge(kind) {
+    async judge(kind, files) {
       judged.push(kind);
+      judgedFiles.push(files.map((f) => path.basename(f)));
       return verdicts.shift() ?? pass;
@@ -71,3 +73,3 @@ function fakes(verdicts: Verdict[] = []) {
   };
-  return { engines, calls, cleanFrameArgs, cleanFrameKeys, find, avoids, judged };
+  return { engines, calls, cleanFrameArgs, cleanFrameKeys, find, avoids, judged, judgedFiles };
 }
@@ -197,2 +199,11 @@ describe("pipeline", () => {
 
+  it("final judge gets full, raw, then crops; a seam fail retries with avoid and keeps needs review", async () => {
+    const { judgedFiles, calls, avoids, notes } = await run([pass, bad(["hard edge"], ["seam"]), bad(["still"], ["seam"])]);
+    expect(judgedFiles[1]).toEqual(["binder.full.png", "binder.raw.png", "binder.crop1.png"]);
+    expect(judgedFiles[2]).toEqual(["binder.full2.png", "binder.raw2.png", "binder.crop21.png"]);
+    expect(calls.fill).toBe(2);
+    expect(avoids.at(-1)).toEqual(["hard edge"]);
+    expect(notes["binder check"]).toBe("needs review: seam");
+  });
+
   it("failing clean retries once with avoid and the retry is passed on", async () => {
diff --git a/src/lib/pipeline.ts b/src/lib/pipeline.ts
--- a/src/lib/pipeline.ts
+++ b/src/lib/pipeline.ts
@@ -210,5 +210,5 @@ export async function runPipeline(
       async (buf, tag) => {
-        const { full, crops } = await finalPreviews(format, buf, originals.map((png, k) => ({ cell: input.cells[k], png })));
-        const files = [`${format}.full${tag}.png`, ...crops.map((_, i) => `${format}.crop${tag}${i + 1}.png`)].map((f) => path.join(work, f));
-        await Promise.all([full, ...crops].map((b, i) => writeFile(files[i], b)));
+        const { full, raw, crops } = await finalPreviews(format, buf, originals.map((png, k) => ({ cell: input.cells[k], png })));
+        const files = [`${format}.full${tag}.png`, `${format}.raw${tag}.png`, ...crops.map((_, i) => `${format}.crop${tag}${i + 1}.png`)].map((f) => path.join(work, f));
+        await Promise.all([full, raw, ...crops].map((b, i) => writeFile(files[i], b)));
         return engines.judge("final", files, work);
```
