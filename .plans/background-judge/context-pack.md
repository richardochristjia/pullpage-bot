# Context pack

BASE: link-cut-export (three-dot diff to HEAD of `background-judge`)
CHANGED: 12 source/test/doc files (+~420/-35); plan folder files excluded. Uncommitted edits to `.plans/*` are not in the diff.

## What this change does
After each agy clean and each format's fill, a Claude judge (3 parallel `claude -p --model sonnet --allowedTools Read` votes, 2-of-3 per check) rates the image. On a gate fail (clean: `invented`; final: `scale`) the agy step reruns once with `Avoid: <problems>.` appended; the attempt with fewer flags is kept (tie: retry). Judge errors never fail the run. Spec: `.plans/background-judge/plan.md`.

## Files
- `src/lib/engines/types.ts:13-18,23` — `Verdict`, `Engines.judge`, `avoid?` on clean/fill, new `CLEAN_PROMPT`
- `src/lib/engines/agy.ts:75-84,113-114` — `editImage` appends ` Avoid: a; b.` to the instruction
- `src/lib/engines/figma.ts:64-72,97-148` — `runClaude` opts `{model,tools,cwd}`; `JUDGE_RULES`, `judgePrompt`, `judge`
- `src/lib/imaging.ts:52-88` — `cleanPair`, `finalPreviews` (full ≤1200px + per-card crops with 300px margin, clamped)
- `src/lib/pipeline.ts:75-101,103-160` — `check()` helper; clean loop and per-format fill loop call it
- `src/lib/runs.ts:3,26` — wires `judge` into `defaultEngines`
- `src/app/page.tsx:264` — shows `s.error` as muted note on done steps
- `README.md:29` — one line on the checks
- tests: `agy.test.ts`, `figma.test.ts`, `imaging.test.ts`, `pipeline.test.ts` (same dirs)

## API contracts
- No HTTP endpoints. Internal: `Engines.judge(kind: "clean"|"final", pngPaths, cwd): Promise<Verdict>` declared `src/lib/engines/types.ts:18`; `Verdict` at `:13`.
- Judge vote reply (from Claude): JSON `{invented|seam, color, scale, smear: bool, problems: string[]}`, parsed by existing `extractJson` (`figma.ts`).
- `OnStep(label, status, error?)` at `src/lib/pipeline.ts:15`: `error` is now also the note on `done` steps (`pass`, `pass after retry`, `needs review: <flags>`, `skipped: <err>`, `... (retry failed: <err>)`).
- `runClaude(prompt, timeoutMs, spawn, o)` `figma.ts:66`: defaults unchanged (haiku + Figma tools) when `o` is omitted.

## Test entry points
- `npx vitest run src/lib/engines/agy.test.ts src/lib/engines/figma.test.ts src/lib/imaging.test.ts src/lib/pipeline.test.ts`
- Full gate: `npm test && npm run lint && npm run build`

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
10. manual: re-run "Umbreon Ketinggalan" (toploader, cell 4) on a Mac with agy and Claude logged in; the background continues the card's pink-eave roof without a break and both check steps show notes. (outside automated verification)

## Do not re-derive
- Only the kept image flows on (`cleaned[]` to canvas/`cleanFrame`, `bg` to `figma`): `pipeline.ts:75-101`.
- `keepRetry = v2.flags.length <= v1.flags.length` counts all flags, not just the gate: `pipeline.ts:97`. A skipped retry verdict has 0 flags, so it wins the tie.
- Judge previews are written to `.work/<id>/` (the `work` dir); `cwd` for `claude` is that dir so `Read ./name.png` resolves.
- Known divergence (plan.md): a throwing retry keeps the first attempt and adds `(retry failed: …)`.
- OCR retry loop in `editImage` is untouched; `avoid` is only in the prompt string.
- Judge prompts and gate rules are from probes on 4 cleans/3 frames; risks in `risks.md`.

## Diff
Source diff for `types.ts`, `agy.ts`, `runs.ts`, `page.tsx`, `README.md` is small: `git diff link-cut-export...HEAD -- <file>`. Tests: same. Core files below.

```diff
diff --git a/src/lib/engines/figma.ts b/src/lib/engines/figma.ts
--- a/src/lib/engines/figma.ts
+++ b/src/lib/engines/figma.ts
@@ -7,3 +7,3 @@ import { CANVAS, CARD, FORMATS, cardRect, type Format } from "../geometry";
 import { jpegUnder } from "../imaging";
-import type { CleanFrameInput, FigmaInput } from "./types";
+import type { CleanFrameInput, FigmaInput, Verdict } from "./types";
 
@@ -63,3 +63,5 @@ const TOOLS = ["create_session", "use_figma", "upload_assets", "download_assets"
 
-export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nodeSpawn = nodeSpawn) {
+export type ClaudeOpts = { model?: string; tools?: string; cwd?: string };
+
+export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nodeSpawn = nodeSpawn, o: ClaudeOpts = {}) {
   return new Promise<string>((resolve, reject) => {
@@ -67,4 +69,4 @@ export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nod
       "claude",
-      ["-p", prompt, "--model", "haiku", "--allowedTools", TOOLS, "--output-format", "json"],
-      { stdio: ["ignore", "pipe", "pipe"] },
+      ["-p", prompt, "--model", o.model ?? "haiku", "--allowedTools", o.tools ?? TOOLS, "--output-format", "json"],
+      { stdio: ["ignore", "pipe", "pipe"], ...(o.cwd ? { cwd: o.cwd } : {}) },
     );
@@ -94,2 +96,55 @@ export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nod
 
+const JUDGE_RULES = {
+  clean: { checks: ["invented", "color", "scale", "smear"], gate: "invented" },
+  final: { checks: ["seam", "scale", "smear"], gate: "scale" },
+} as const;
+
+function judgePrompt(kind: "clean" | "final", names: string[]) {
+  const reply = (cs: readonly string[]) =>
+    `Reply with only JSON: {${cs.map((c) => `"${c}": bool`).join(", ")}, "problems": ["..."]}.`;
+  if (kind === "clean") {
+    return `Read ./${names[0]}. Left: a trading card. Right: an image generated to extend ONLY the illustration in the card art window outward to fill the canvas. Look first at what the art window itself shows, then at what the right image adds outside that area. Answer each question with true or false:
+invented: the added area shows scenery the art window does not (new sky, buildings, weather, night, landscape)
+color: the added area clearly shifts color, brightness or lighting from the art window
+scale: objects continued from the art window change size or perspective
+smear: any region is smeared, melted, blurry or nonsensical
+${reply(JUDGE_RULES.clean.checks)}`;
+  }
+  return `Read ./${names[0]} (full print insert) and ${names.slice(1).map((n) => `./${n}`).join(" ")} (zoom on each trading card and the background around it). The background was generated to extend the illustration inside the card art window outward. Answer each question with true or false:
+seam: at the edges of the card, the background does not read as a continuation of the art window (colors, lighting, surfaces or lines break)
+scale: objects continued from the art window are clearly a different size or perspective outside the card
+smear: any background region is smeared, melted, blurry or nonsensical
+${reply(JUDGE_RULES.final.checks)}`;
+}
+
+type JudgeClaude = (prompt: string, timeoutMs: number, spawn: undefined, o: ClaudeOpts) => Promise<string>;
+
+// Three parallel votes, majority (2 of 3) per check. A vote that throws or can't be parsed counts as nothing.
+export async function judge(
+  kind: "clean" | "final",
+  paths: string[],
+  cwd: string,
+  claude: JudgeClaude = runClaude,
+): Promise<Verdict> {
+  const { checks, gate } = JUDGE_RULES[kind];
+  const prompt = judgePrompt(kind, paths.map((p) => path.basename(p)));
+  const votes = await Promise.allSettled(
+    [0, 1, 2].map(async () => extractJson(await claude(prompt, 120_000, undefined, { model: "sonnet", tools: "Read", cwd }))),
+  );
+  const ok = votes.flatMap((v) => (v.status === "fulfilled" && v.value ? [v.value] : []));
+  if (!ok.length) {
+    const last = [...votes].reverse().find((v) => v.status === "rejected") as PromiseRejectedResult | undefined;
+    return { fail: false, flags: [], problems: [], skipped: String(last?.reason?.message ?? last?.reason ?? "no verdict") };
+  }
+  const flags = checks.filter((c) => ok.filter((v) => v[c] === true).length >= 2);
+  const problems = [
+    ...new Set(
+      ok.flatMap((v) => (Array.isArray(v.problems) ? v.problems : []))
+        .filter((p): p is string => typeof p === "string" && !!p.trim())
+        .map((p) => p.trim().slice(0, 200)),
+    ),
+  ].slice(0, 5);
+  return { fail: flags.includes(gate), flags, problems };
+}
+
 export type FigmaDeps = { claude: (prompt: string) => Promise<string>; fetch: typeof fetch; fileKey: string };
diff --git a/src/lib/imaging.ts b/src/lib/imaging.ts
--- a/src/lib/imaging.ts
+++ b/src/lib/imaging.ts
@@ -50 +50,39 @@ export async function jpegUnder(buf: Buffer, maxBytes = 9.5 * 1024 * 1024) {
 }
+
+const GAP = 32;
+const MARGIN = 300;
+const FULL_MAX = 1200;
+
+// Original card (left) and cleaned card (right) in one PNG for the clean judge.
+export async function cleanPair(orig: Buffer, clean: Buffer) {
+  const fit = (b: Buffer) => sharp(b).resize(CARD.w, CARD.h, { fit: "fill" }).png().toBuffer();
+  return sharp({ create: { width: CARD.w * 2 + GAP, height: CARD.h, channels: 3, background: WHITE } })
+    .composite([
+      { input: await fit(orig), left: 0, top: 0 },
+      { input: await fit(clean), left: CARD.w + GAP, top: 0 },
+    ])
+    .png()
+    .toBuffer();
+}
+
+// Background with the original cards placed on it: a shrunk full frame plus one crop per card with a margin.
+export async function finalPreviews(format: Format, bg: Buffer, cards: { cell: number; png: Buffer }[]) {
+  const placed = await sharp(bg)
+    .composite(cards.map(({ cell, png }) => ({ input: png, left: cardRect(format, cell).x, top: cardRect(format, cell).y })))
+    .png()
+    .toBuffer();
+  const { width, height } = await sharp(placed).metadata();
+  const full = await sharp(placed).resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
+  const crops = await Promise.all(
+    cards.map(({ cell }) => {
+      const r = cardRect(format, cell);
+      const left = Math.max(0, r.x - MARGIN);
+      const top = Math.max(0, r.y - MARGIN);
+      return sharp(placed)
+        .extract({ left, top, width: Math.min(width!, r.x + r.w + MARGIN) - left, height: Math.min(height!, r.y + r.h + MARGIN) - top })
+        .png()
+        .toBuffer();
+    }),
+  );
+  return { full, crops };
+}
diff --git a/src/lib/pipeline.ts b/src/lib/pipeline.ts
--- a/src/lib/pipeline.ts
+++ b/src/lib/pipeline.ts
@@ -3,4 +3,4 @@ import path from "node:path";
 import { FORMATS, type Format } from "./geometry";
-import { composeCanvas, toCard } from "./imaging";
-import type { Engines } from "./engines/types";
+import { cleanPair, composeCanvas, finalPreviews, toCard } from "./imaging";
+import type { Engines, Verdict } from "./engines/types";
 
@@ -14,3 +14,3 @@ export type RunInput = {
 export type StepStatus = "pending" | "running" | "done" | "failed";
-export type OnStep = (label: string, status: StepStatus, error?: string) => void;
+export type OnStep = (label: string, status: StepStatus, error?: string) => void; // error doubles as a note on done steps
 
@@ -73,2 +73,30 @@ export async function runPipeline(
 
+  // Judge an attempt; on a fail regenerate once with the judge's problems and keep the one with fewer flags (tie: the retry).
+  const check = async (
+    label: string,
+    first: Buffer,
+    judgeIt: (buf: Buffer, tag: string) => Promise<Verdict>,
+    retry: (avoid: string[]) => Promise<Buffer>,
+  ) => {
+    onStep(label, "running");
+    const note = (v: Verdict, retried: boolean) =>
+      v.skipped ? `skipped: ${v.skipped}` : v.fail ? `needs review: ${v.flags.join(", ")}` : retried ? "pass after retry" : "pass";
+    const v1 = await judgeIt(first, "");
+    if (!v1.fail) {
+      onStep(label, "done", note(v1, false));
+      return first;
+    }
+    let second: Buffer;
+    try {
+      second = await retry(v1.problems);
+    } catch (e) {
+      onStep(label, "done", `${note(v1, false)} (retry failed: ${(e as Error).message})`);
+      return first;
+    }
+    const v2 = await judgeIt(second, "2");
+    const keepRetry = v2.flags.length <= v1.flags.length;
+    onStep(label, "done", note(keepRetry ? v2 : v1, true));
+    return keepRetry ? second : first;
+  };
+
   const originals = await step("resize", () => Promise.all(input.cards.map((c) => toCard(c.buf))));
@@ -76,10 +104,24 @@ export async function runPipeline(
   for (const [k, orig] of originals.entries()) {
+    const inp = path.join(work, `card${k}.png`);
+    const out = path.join(work, `card${k}.clean.png`);
+    const first = await step(`clean card ${k + 1}`, async () => {
+      await writeFile(inp, orig);
+      await engines.clean(inp, out);
+      return readFile(out);
+    });
     cleaned.push(
-      await step(`clean card ${k + 1}`, async () => {
-        const inp = path.join(work, `card${k}.png`);
-        const out = path.join(work, `card${k}.clean.png`);
-        await writeFile(inp, orig);
-        await engines.clean(inp, out);
-        return readFile(out);
-      }),
+      await check(
+        `clean card ${k + 1} check`,
+        first,
+        async (buf, tag) => {
+          const pair = path.join(work, `card${k}.pair${tag}.png`);
+          await writeFile(pair, await cleanPair(orig, buf));
+          return engines.judge("clean", [pair], work);
+        },
+        async (avoid) => {
+          const out2 = path.join(work, `card${k}.clean2.png`);
+          await engines.clean(inp, out2, avoid);
+          return readFile(out2);
+        },
+      ),
     );
@@ -92,6 +134,6 @@ export async function runPipeline(
     );
-    const bg = await step(`${format} background`, async () => {
-      const inp = path.join(work, `${format}.canvas.png`);
-      const out = path.join(work, `${format}.bg.png`);
+    const inp = path.join(work, `${format}.canvas.png`);
+    const firstBg = await step(`${format} background`, async () => {
       await writeFile(inp, canvas);
+      const out = path.join(work, `${format}.bg.png`);
       await engines.fill(inp, out);
@@ -99,2 +141,17 @@ export async function runPipeline(
     });
+    const bg = await check(
+      `${format} check`,
+      firstBg,
+      async (buf, tag) => {
+        const { full, crops } = await finalPreviews(format, buf, originals.map((png, k) => ({ cell: input.cells[k], png })));
+        const files = [`${format}.full${tag}.png`, ...crops.map((_, i) => `${format}.crop${tag}${i + 1}.png`)].map((f) => path.join(work, f));
+        await Promise.all([full, ...crops].map((b, i) => writeFile(files[i], b)));
+        return engines.judge("final", files, work);
+      },
+      async (avoid) => {
+        const out2 = path.join(work, `${format}.bg2.png`);
+        await engines.fill(inp, out2, avoid);
+        return readFile(out2);
+      },
+    );
     const r = await step(`${format} figma`, () =>
```
