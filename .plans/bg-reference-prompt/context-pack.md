# Context pack

BASE: background-judge (commit d5bb85a)
CHANGED: 7 source/test files (+~160/-8), plus plan files and `.agents/RECORD.md`

## What this change does
Background fill step takes an optional user prompt (`bgPrompt`, <=1000 chars) and one reference image (`bgRef`). The pipeline writes the ref once to `.work/<id>/bg-ref.png` and passes `{prompt, ref}` to both `engines.fill` calls (first attempt and judge retry). The agy engine copies it to `ref.png` and appends it to the instruction. Clean is untouched.

## Files
- `src/lib/engines/types.ts:15` — `FillExtra` type; `Engines.fill` gets a 4th arg (line 19)
- `src/lib/engines/agy.ts:75` — `editImage` builds the agy prompt, writes `ref.png`; `agyEngines().fill` passes extra (line ~117); `clean` does not
- `src/lib/pipeline.ts:46` — `validateRun` ref/prompt checks; `:138` builds `extra`; `:157,171` fill calls
- `src/app/api/runs/route.ts:22` — reads `bgRef` (string value -> 400) and `bgPrompt` from the form
- `src/app/page.tsx:141,168,260` — textarea, paste/drop box, thumbnail, Remove, form fields
- `src/lib/engines/agy.test.ts:124`, `src/lib/pipeline.test.ts:84,95` — new tests
- Not source: `.plans/bg-reference-prompt/*`, `.agents/RECORD.md`

## API contracts
- `POST /api/runs` multipart: new optional `bgPrompt` (string) and `bgRef` (File). Handler: `src/app/api/runs/route.ts`. Input type: `RunInput` in `src/lib/pipeline.ts:8-15`.
- `Engines.fill(inPng, outPath, avoid?, extra?: FillExtra)` declared at `src/lib/engines/types.ts:19`.

## Test entry points
- `src/lib/engines/agy.test.ts` — `npx vitest run src/lib/engines/agy.test.ts`
- `src/lib/pipeline.test.ts` — `npx vitest run src/lib/pipeline.test.ts`
- All: `npm test` (vitest run), then `npm run build`

## Acceptance criteria (from .plans/bg-reference-prompt/plan.md)
1. With no `bgPrompt` and no `bgRef`, the agy fill prompt is identical to today and no `ref.png` is written; all existing tests pass unchanged. Check: agy.test + `npm test`.
2. With prompt and ref, the agy folder contains `ref.png` and the prompt contains `FILL_PROMPT`, then the reference line, then `Additional instruction from the user: <text>`, in that order. Check: agy.test.
3. Pipeline passes the same `{ prompt, ref }` to every fill call: both formats and the judge retry (retry also gets `avoid`). Check: pipeline.test.
4. `validateRun` returns an error for a ref that is not png/jpeg/webp, a ref over 25MB, and a prompt over 1000 chars; a run without either is valid as today. Check: pipeline.test.
5. Clean calls never receive extra and their prompt is unchanged. Check: agy.test/pipeline.test.
6. `npm test` and `npm run build` pass.
7. manual: Copy an image to the clipboard, click the paste box, press Cmd+V — thumbnail appears; Remove clears it; dropping an image on the box also works. (outside automated verification)
8. manual: Run 1 card, toploader, with a reference and a prompt — background visibly follows the reference and the run finishes. (outside automated verification)

## Do not re-derive
- Branch is cut from `background-judge`, not `main` (main has only the init commit).
- Prompt order in `agy.ts:84-87`: instruction, then ref line, then user line, then ` Avoid:`. With no extra the string is unchanged.
- `extra` is built once per run in `pipeline.ts:138`; empty prompt and no ref gives `undefined`.
- `maxLength={1000}` in the UI is untrimmed; the server check in `validateRun` is on the raw string, while `route.ts` trims first.
- Judges, clean step and `cleanFrame` are unchanged on purpose. A ref that clashes with the card art may flag "needs review" (expected, see plan Risks).
- Pipeline test at `pipeline.test.ts:95` uses the existing `fakes([...])` verdict script; it expects 3 fill calls (binder, toploader, one retry).

## Diff (src only; plan/RECORD files omitted)
```diff
diff --git a/src/app/api/runs/route.ts b/src/app/api/runs/route.ts
index 9e2d631..6a21d03 100644
--- a/src/app/api/runs/route.ts
+++ b/src/app/api/runs/route.ts
@@ -19,12 +19,17 @@ export async function POST(req: Request) {
         return { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) };
       }),
     );
+    const ref = form.get("bgRef");
+    if (typeof ref === "string") throw new Error("bgRef must be a file");
+    const bgPrompt = String(form.get("bgPrompt") ?? "").trim();
     input = {
       cards,
       cells: JSON.parse(String(form.get("cells") ?? "[]")),
       formats: JSON.parse(String(form.get("formats") ?? "[]")),
       name: String(form.get("name") ?? ""),
       fileKey: process.env.FIGMA_FILE_KEY,
+      bgPrompt: bgPrompt || undefined,
+      bgRef: ref ? { name: ref.name, type: ref.type, buf: Buffer.from(await ref.arrayBuffer()) } : undefined,
     };
   } catch {
     return NextResponse.json({ errors: ["Bad request."] }, { status: 400 });
diff --git a/src/app/page.tsx b/src/app/page.tsx
index 52ef1d3..82cc05b 100644
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -138,6 +138,8 @@ export default function Page() {
   const [cards, setCards] = useState<Card[]>([]);
   const [formats, setFormats] = useState<Format[]>(["binder"]);
   const [name, setName] = useState("");
+  const [bgPrompt, setBgPrompt] = useState("");
+  const [bgRef, setBgRef] = useState<{ file: File; url: string } | null>(null);
   const [run, setRun] = useState<RunView | null>(null);
   const [errors, setErrors] = useState<string[]>([]);
   const [past, setPast] = useState<PastRun[]>([]);
@@ -163,6 +165,12 @@ export default function Page() {
   const toggleFormat = (f: Format) =>
     setFormats((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]));
 
+  const setRef = (file?: File | null) => {
+    if (!file || !file.type.startsWith("image/")) return;
+    setBgRef((p) => (p && URL.revokeObjectURL(p.url), { file, url: URL.createObjectURL(file) }));
+  };
+  const clearRef = () => setBgRef((p) => (p && URL.revokeObjectURL(p.url), null));
+
   async function start() {
     setErrors([]);
     const form = new FormData();
@@ -170,6 +178,8 @@ export default function Page() {
     form.append("cells", JSON.stringify(cells));
     form.append("formats", JSON.stringify(formats));
     form.append("name", name || cards[0].file.name);
+    if (bgPrompt.trim()) form.append("bgPrompt", bgPrompt);
+    if (bgRef) form.append("bgRef", bgRef.file);
     const res = await fetch("/api/runs", { method: "POST", body: form });
     const body = await res.json();
     if (!res.ok) return setErrors(body.errors ?? ["Could not start the run."]);
@@ -247,6 +257,30 @@ export default function Page() {
           </label>
         ))}
         <input placeholder="run name" value={name} onChange={(e) => setName(e.target.value)} />
+        <textarea
+          placeholder="Background prompt (optional)"
+          maxLength={1000}
+          value={bgPrompt}
+          onChange={(e) => setBgPrompt(e.target.value)}
+        />
+        <div
+          tabIndex={0}
+          onPaste={(e) => setRef(Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"))?.getAsFile())}
+          onDragOver={(e) => e.preventDefault()}
+          onDrop={(e) => {
+            e.preventDefault();
+            setRef(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")));
+          }}
+        >
+          {bgRef ? (
+            <>
+              <img src={bgRef.url} alt="background reference" height={60} />{" "}
+              <button type="button" onClick={clearRef}>Remove</button>
+            </>
+          ) : (
+            "Click, then paste an image (Cmd+V) or drop one"
+          )}
+        </div>
         <button disabled={!valid || running} onClick={start}>
           {failed || run?.status === "done" ? "Run again" : "Run"}
         </button>
diff --git a/src/lib/engines/agy.test.ts b/src/lib/engines/agy.test.ts
index 25420b7..cdc6e6d 100644
--- a/src/lib/engines/agy.test.ts
+++ b/src/lib/engines/agy.test.ts
@@ -121,6 +121,24 @@ describe("agy", () => {
     expect(calls[1].args[1]).toContain(`${CLEAN_PROMPT} Avoid: rain on the left; night sky.`);
   });
 
+  it("fill without extra is unchanged; with extra writes ref.png and orders the prompt; clean ignores extra", async () => {
+    const { inp, outp, spawn, calls, scripted } = await setup();
+    const { check } = scripted([], [], [], []);
+    const ref = path.join(path.dirname(inp), "myref.jpg");
+    await writeFile(ref, await sharp({ create: { width: 20, height: 20, channels: 3, background: "purple" } }).jpeg().toBuffer());
+    await agyEngines(spawn, check).fill(inp, outp);
+    expect(calls[0].args[1]).toContain(`Instruction: ${FILL_PROMPT}`);
+    expect(calls[0].args[1]).not.toContain("ref.png");
+    expect(await exists(`${outp}.agy/ref.png`)).toBe(false);
+    await agyEngines(spawn, check).fill(inp, outp, ["x"], { prompt: "stars", ref });
+    const p = calls[1].args[1];
+    const at = [FILL_PROMPT, "./ref.png", "Additional instruction from the user: stars", "Avoid: x."].map((t) => p.indexOf(t));
+    expect(at.every((n) => n >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
+    expect(await exists(`${outp}.agy/ref.png`)).toBe(true);
+    await (agyEngines(spawn, check).clean as any)(inp, outp, undefined, { prompt: "stars", ref });
+    expect(calls[2].args[1]).not.toContain("stars");
+  });
+
   it("text then clean: two agy calls, file written", async () => {
     const { inp, outp, spawn, calls, scripted } = await setup();
     const { check } = scripted(["Espeon"], []);
diff --git a/src/lib/engines/agy.ts b/src/lib/engines/agy.ts
index 620b12b..d8e0b93 100644
--- a/src/lib/engines/agy.ts
+++ b/src/lib/engines/agy.ts
@@ -3,7 +3,7 @@ import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
 import path from "node:path";
 import sharp from "sharp";
 import { padTo34, unpadFrom34 } from "../imaging";
-import { CLEAN_PROMPT, FILL_PROMPT, type Engines } from "./types";
+import { CLEAN_PROMPT, FILL_PROMPT, type Engines, type FillExtra } from "./types";
 
 type SpawnFn = typeof nodeSpawn;
 
@@ -72,7 +72,7 @@ export function findText(pngPath: string, spawn: SpawnFn = nodeSpawn): Promise<s
   });
 }
 
-async function editImage(step: string, inPath: string, outPath: string, instruction: string, spawn: SpawnFn, check: CheckFn, avoid: string[] = []) {
+async function editImage(step: string, inPath: string, outPath: string, instruction: string, spawn: SpawnFn, check: CheckFn, avoid: string[] = [], extra?: FillExtra) {
   const src = await readFile(inPath);
   const { width, height } = await sharp(src).metadata();
   const { buf, box } = await padTo34(src, width!, height!);
@@ -80,8 +80,11 @@ async function editImage(step: string, inPath: string, outPath: string, instruct
   await mkdir(dir, { recursive: true });
   // agy returns 896x1200 whatever it is given, so a bigger input only slows the call.
   await writeFile(path.join(dir, "in.png"), await sharp(buf).resize(896, 1200, { fit: "fill" }).png().toBuffer());
+  if (extra?.ref) await writeFile(path.join(dir, "ref.png"), await sharp(extra.ref).png().toBuffer());
+  const refLine = extra?.ref ? " Pass ./ref.png to the image generation tool as a second input image; it is a reference only, never copy its text." : "";
+  const userLine = extra?.prompt ? ` Additional instruction from the user: ${extra.prompt}` : "";
   const prompt =
-    `Use your image generation tool to edit the image ./in.png with this instruction, then save the result in this folder as out.png, and reply with the saved path. Do not use any API key. Do not upscale the result yourself. Generate exactly one image: no retries, variations or extra attempts. If the image generation tool fails, stop and reply with the error: never edit or create the image with code, scripts or any other tool. Instruction: ${instruction}${avoid.length ? ` Avoid: ${avoid.join("; ")}.` : ""}`;
+    `Use your image generation tool to edit the image ./in.png with this instruction, then save the result in this folder as out.png, and reply with the saved path. Do not use any API key. Do not upscale the result yourself. Generate exactly one image: no retries, variations or extra attempts. If the image generation tool fails, stop and reply with the error: never edit or create the image with code, scripts or any other tool. Instruction: ${instruction}${refLine}${userLine}${avoid.length ? ` Avoid: ${avoid.join("; ")}.` : ""}`;
   for (let attempt = 1; ; attempt++) {
     const reply = await runAgy(dir, prompt, undefined, spawn);
     const out = await readOutput(dir);
@@ -111,6 +114,6 @@ async function editImage(step: string, inPath: string, outPath: string, instruct
 export function agyEngines(spawn: SpawnFn = nodeSpawn, check: CheckFn = findText): Pick<Engines, "clean" | "fill"> {
   return {
     clean: (i, o, avoid) => editImage("clean", i, o, CLEAN_PROMPT, spawn, check, avoid),
-    fill: (i, o, avoid) => editImage("fill", i, o, FILL_PROMPT, spawn, check, avoid),
+    fill: (i, o, avoid, extra) => editImage("fill", i, o, FILL_PROMPT, spawn, check, avoid, extra),
   };
 }
diff --git a/src/lib/engines/types.ts b/src/lib/engines/types.ts
index 565a743..823365f 100644
--- a/src/lib/engines/types.ts
+++ b/src/lib/engines/types.ts
@@ -12,9 +12,11 @@ export type CleanFrameInput = { name: string; cleaned: Buffer[]; workDir: string
 
 export type Verdict = { fail: boolean; flags: string[]; problems: string[]; skipped?: string };
 
+export type FillExtra = { prompt?: string; ref?: string }; // ref is a file path
+
 export interface Engines {
   clean(inPng: string, outPath: string, avoid?: string[]): Promise<void>;
-  fill(inPng: string, outPath: string, avoid?: string[]): Promise<void>;
+  fill(inPng: string, outPath: string, avoid?: string[], extra?: FillExtra): Promise<void>;
   judge(kind: "clean" | "final", pngPaths: string[], cwd: string): Promise<Verdict>;
   cleanFrame(input: CleanFrameInput): Promise<{ frameId: string }>;
   figma(input: FigmaInput): Promise<{ url: string; pngPath: string; frameId: string }>;
diff --git a/src/lib/pipeline.test.ts b/src/lib/pipeline.test.ts
index f05b1fa..aac81f8 100644
--- a/src/lib/pipeline.test.ts
+++ b/src/lib/pipeline.test.ts
@@ -81,6 +81,31 @@ describe("pipeline", () => {
     expect(validateRun(ok, "")).not.toEqual([]);
   });
 
+  it("validateRun checks the background prompt and reference", async () => {
+    const c = await card("a.png");
+    const ok: RunInput = { cards: [c], cells: [4], formats: ["binder"] };
+    const ref = { name: "r.png", type: "image/png", buf: Buffer.from("x") };
+    expect(validateRun({ ...ok, bgPrompt: "x".repeat(1000), bgRef: ref }, "K")).toEqual([]);
+    expect(validateRun({ ...ok, bgPrompt: "x".repeat(1001) }, "K")).not.toEqual([]);
+    expect(validateRun({ ...ok, bgRef: { ...ref, type: "image/gif" } }, "K")).not.toEqual([]);
+    expect(validateRun({ ...ok, bgRef: { ...ref, buf: Buffer.alloc(25 * 1024 * 1024 + 1) } }, "K")).not.toEqual([]);
+  });
+
+  it("the same extra reaches both formats and the fill retry; clean gets none", async () => {
+    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
+    const f = fakes([pass, bad(["a"], ["scale"]), pass, pass]);
+    const extras: unknown[] = [];
+    const fill = f.engines.fill;
+    f.engines.fill = (i, o, avoid, extra) => (extras.push(extra), fill(i, o, avoid, extra));
+    const bgRef = { name: "r.png", type: "image/png", buf: await img(10, 10, "purple") };
+    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder", "toploader"], bgPrompt: "stars", bgRef };
+    await runPipeline("rx", input, f.engines, () => {}, root);
+    const ref = path.join(root, ".work", "rx", "bg-ref.png");
+    expect(existsSync(ref)).toBe(true);
+    expect(extras).toHaveLength(3);
+    for (const e of extras) expect(e).toEqual({ prompt: "stars", ref });
+  }, 60000);
+
   it("both formats, 2 cards: clean x2, fill x2, figma x2; canvas size and card pixels exact", async () => {
     const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
     const { engines, calls, cleanFrameArgs } = fakes();
diff --git a/src/lib/pipeline.ts b/src/lib/pipeline.ts
index 9bd884e..deb0c94 100644
--- a/src/lib/pipeline.ts
+++ b/src/lib/pipeline.ts
@@ -2,7 +2,8 @@ import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
 import path from "node:path";
 import { FORMATS, type Format } from "./geometry";
 import { cleanPair, composeCanvas, finalPreviews, toCard } from "./imaging";
-import type { Engines, Verdict } from "./engines/types";
+import sharp from "sharp";
+import type { Engines, FillExtra, Verdict } from "./engines/types";
 
 export type RunInput = {
   cards: { name: string; type: string; buf: Buffer }[];
@@ -10,6 +11,8 @@ export type RunInput = {
   formats: Format[];
   name?: string;
   fileKey?: string;
+  bgPrompt?: string;
+  bgRef?: { name: string; type: string; buf: Buffer };
 };
 export type StepStatus = "pending" | "running" | "done" | "failed";
 export type OnStep = (label: string, status: StepStatus, error?: string) => void; // error doubles as a note on done steps
@@ -43,6 +46,11 @@ export function validateRun(i: RunInput, fileKey = process.env.FIGMA_FILE_KEY):
   if (!i.formats.length || new Set(i.formats).size !== i.formats.length || !i.formats.every((f) => FORMATS.includes(f))) {
     e.push("Pick binder, toploader or both.");
   }
+  if (i.bgRef) {
+    if (!TYPES.includes(i.bgRef.type)) e.push("Reference image must be png, jpeg or webp.");
+    if (i.bgRef.buf.length > MAX_BYTES) e.push("Reference image is larger than 25MB.");
+  }
+  if (i.bgPrompt && i.bgPrompt.length > 1000) e.push("Background prompt is longer than 1000 characters.");
   if (!runName(i)) e.push("Name must be letters, digits, _ or -.");
   if (!fileKey) e.push("FIGMA_FILE_KEY is not set.");
   return e;
@@ -127,6 +135,16 @@ export async function runPipeline(
     );
   }
 
+  let extra: FillExtra | undefined;
+  if (input.bgRef || input.bgPrompt) {
+    let ref: string | undefined;
+    if (input.bgRef) {
+      ref = path.join(work, "bg-ref.png");
+      await writeFile(ref, await sharp(input.bgRef.buf).png().toBuffer());
+    }
+    extra = { prompt: input.bgPrompt || undefined, ref };
+  }
+
   const results: { format: Format; figmaUrl: string; pngPath: string; frameId: string }[] = [];
   for (const format of input.formats) {
     const canvas = await step(`${format} canvas`, () =>
@@ -136,7 +154,7 @@ export async function runPipeline(
     const firstBg = await step(`${format} background`, async () => {
       await writeFile(inp, canvas);
       const out = path.join(work, `${format}.bg.png`);
-      await engines.fill(inp, out);
+      await engines.fill(inp, out, undefined, extra);
       return readFile(out);
     });
     const bg = await check(
@@ -150,7 +168,7 @@ export async function runPipeline(
       },
       async (avoid) => {
         const out2 = path.join(work, `${format}.bg2.png`);
-        await engines.fill(inp, out2, avoid);
+        await engines.fill(inp, out2, avoid, extra);
         return readFile(out2);
       },
     );
```
