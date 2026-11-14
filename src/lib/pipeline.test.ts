import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CANVAS, cardRect } from "./geometry";
import { padTo34, toCard, unpadFrom34 } from "./imaging";
import { cardKey, displayName, planSteps, runPipeline, validateRun, type RunInput } from "./pipeline";
import { CLEAN_PROMPT, type Engines, type Verdict } from "./engines/types";

const img = (w: number, h: number, c: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function card(name: string) {
  // gradient-ish so pixel identity is meaningful
  const raw = Buffer.alloc(736 * 1024 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 256;
  return { name, type: "image/png", buf: await sharp(raw, { raw: { width: 736, height: 1024, channels: 3 } }).png().toBuffer() };
}

const pass: Verdict = { fail: false, flags: [], problems: [] };

function fakes(verdicts: Verdict[] = []) {
  const calls = { clean: 0, fill: 0, figma: 0, cleanFrame: 0 };
  const avoids: (string[] | undefined)[] = [];
  const judged: string[] = [];
  const judgedFiles: string[][] = [];
  const cleanFrameArgs: Buffer[][] = [];
  const cleanFrameKeys: (string | undefined)[][] = [];
  const find = { calls: 0, result: {} as Record<string, Buffer>, throws: false };
  const engines: Engines = {
    async clean(i, o, avoid) {
      calls.clean++;
      avoids.push(avoid);
      await writeFile(o, avoid ? await img(750, 1050, "red") : await readFile(i)); // red marks the retry
    },
    async fill(i, o, avoid) {
      calls.fill++;
      avoids.push(avoid);
      const { width, height } = await sharp(i).metadata();
      const colour = avoid ? "red" : "green"; // red marks the retry
      const { box } = await padTo34(await img(width!, height!, colour), width!, height!);
      await writeFile(o, await unpadFrom34(await img(896, 1200, colour), box));
    },
    async judge(kind, files) {
      judged.push(kind);
      judgedFiles.push(files.map((f) => path.basename(f)));
      return verdicts.shift() ?? pass;
    },
    async cleanFrame(i) {
      calls.cleanFrame++;
      cleanFrameArgs.push(i.cleaned);
      cleanFrameKeys.push(i.keys ?? []);
      return { frameId: "9:9" };
    },
    async findCleans() {
      find.calls++;
      if (find.throws) throw new Error("lookup down");
      return find.result;
    },
    async figma(inp) {
      calls.figma++;
      const base = await sharp(inp.bg).png().toBuffer();
      const out = await sharp(base)
        .composite(inp.originals.map((o) => ({ input: o.png, left: cardRect(inp.format, o.cell).x, top: cardRect(inp.format, o.cell).y })))
        .png()
        .toBuffer();
      const pngPath = path.join(inp.workDir, `fake_${inp.format}.png`);
      await writeFile(pngPath, out);
      return { url: `https://figma/${inp.format}`, pngPath, frameId: `1:${calls.figma}` };
    },
  };
  return { engines, calls, cleanFrameArgs, cleanFrameKeys, find, avoids, judged, judgedFiles };
}

describe("pipeline", () => {
  it("displayName strips extension and path chars", async () => {
    const c = await card("goldeen_ar.png");
    expect(displayName({ cards: [c], cells: [4], formats: ["binder"] })).toBe("goldeen_ar");
    expect(displayName({ cards: [c], cells: [4], formats: ["binder"], name: "a/b:c" })).toBe("abc");
  });

  it("rejects bad input before any engine call", async () => {
    const c = await card("a.png");
    const ok: RunInput = { cards: [c], cells: [4], formats: ["binder"] };
    expect(validateRun(ok, "K")).toEqual([]);
    expect(validateRun({ ...ok, cards: [] , cells: []}, "K")).not.toEqual([]);
    expect(validateRun({ ...ok, cards: [c, c, c, c], cells: [0, 1, 2, 3] }, "K")).not.toEqual([]);
    expect(validateRun({ ...ok, cards: [c, c], cells: [4, 4] }, "K")).not.toEqual([]);
    expect(validateRun(ok, "")).not.toEqual([]);
  });

  it("validateRun checks the background prompt and reference", async () => {
    const c = await card("a.png");
    const ok: RunInput = { cards: [c], cells: [4], formats: ["binder"] };
    const ref = { name: "r.png", type: "image/png", buf: Buffer.from("x") };
    expect(validateRun({ ...ok, bgPrompt: "x".repeat(1000), bgRef: ref }, "K")).toEqual([]);
    expect(validateRun({ ...ok, bgPrompt: "x".repeat(1001) }, "K")).not.toEqual([]);
    expect(validateRun({ ...ok, bgRef: { ...ref, type: "image/gif" } }, "K")).not.toEqual([]);
    expect(validateRun({ ...ok, bgRef: { ...ref, buf: Buffer.alloc(25 * 1024 * 1024 + 1) } }, "K")).not.toEqual([]);
  });

  it("the same extra reaches both formats and the fill retry; clean gets none", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const f = fakes([pass, bad(["a"], ["scale"]), pass, pass]);
    const extras: unknown[] = [];
    const fill = f.engines.fill;
    f.engines.fill = (i, o, avoid, extra) => (extras.push(extra), fill(i, o, avoid, extra));
    const bgRef = { name: "r.png", type: "image/png", buf: await img(10, 10, "purple") };
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder", "toploader"], bgPrompt: "stars", bgRef };
    await runPipeline("rx", input, f.engines, () => {}, root);
    const ref = path.join(root, ".work", "rx", "bg-ref.png");
    expect(existsSync(ref)).toBe(true);
    expect(extras).toHaveLength(3);
    for (const e of extras) expect(e).toEqual({ prompt: "stars", ref });
  }, 60000);

  it("a corrupt reference fails a reference step before any clean call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const { engines, calls } = fakes();
    const steps: [string, string][] = [];
    const bgRef = { name: "r.png", type: "image/png", buf: Buffer.from("not an image") };
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder"], bgRef };
    await expect(runPipeline("rc", input, engines, (l, s) => steps.push([l, s]), root)).rejects.toThrow(/^reference:/);
    expect(steps).toContainEqual(["reference", "failed"]);
    expect(calls.clean).toBe(0);
  }, 60000);

  it("both formats, 2 cards: clean x2, fill x2, figma x2; canvas size and card pixels exact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const { engines, calls, cleanFrameArgs } = fakes();
    const input: RunInput = { cards: [await card("goldeen.png"), await card("b.png")], cells: [4, 5], formats: ["binder", "toploader"], fileKey: "K" };
    const results = await runPipeline("r1", input, engines, () => {}, root);
    expect(calls).toEqual({ clean: 2, fill: 2, figma: 2, cleanFrame: 1 });
    expect(cleanFrameArgs[0]).toHaveLength(2);
    for (const b of cleanFrameArgs[0]) expect(await sharp(b).metadata()).toMatchObject({ width: 750, height: 1050 });
    expect(results.map((r) => r.format)).toEqual(["binder", "toploader"]);
    const meta = JSON.parse(await readFile(path.join(root, "output", "r1", "run.json"), "utf8"));
    expect(meta).toMatchObject({
      id: "r1", name: "goldeen", slug: "goldeen", cells: [4, 5], fileKey: "K", cleanFrameId: "9:9",
      formats: { binder: { frameId: "1:1" }, toploader: { frameId: "1:2" } },
    });
    for (const f of ["binder", "toploader"] as const) {
      const file = path.join(root, "output", "r1", `output_goldeen_${f}.png`);
      const out = sharp(file);
      const m = await out.metadata();
      expect([m.width, m.height]).toEqual([CANVAS[f].w, CANVAS[f].h]);
      const r = cardRect(f, 4);
      const got = await sharp(file).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).removeAlpha().raw().toBuffer();
      const orig = await sharp(await toCard(input.cards[0].buf)).raw().toBuffer();
      expect(got.length).toBe(orig.length);
      expect(got.equals(orig)).toBe(true);
    }
  }, 60000);

  it("clean writing no file fails the run, names the step, leaves output empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const { engines } = fakes();
    engines.clean = async () => {
      throw new Error("clean: agy returned no image");
    };
    const steps: string[] = [];
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder"] };
    await expect(runPipeline("r2", input, engines, (l, s) => steps.push(`${l}:${s}`), root)).rejects.toThrow("clean card 1:");
    expect(steps).toContain("clean card 1:failed");
    expect(existsSync(path.join(root, "output"))).toBe(false);
  });

  it("cleanFrame failure fails the run and leaves output empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const { engines } = fakes();
    engines.cleanFrame = async () => {
      throw new Error("boom");
    };
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder"] };
    await expect(runPipeline("r3", input, engines, () => {}, root)).rejects.toThrow("clean figma: boom");
    expect(existsSync(path.join(root, "output"))).toBe(false);
  });

  const run = async (verdicts: Verdict[], formats: RunInput["formats"] = ["binder"]) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const f = fakes(verdicts);
    const notes: Record<string, string | undefined> = {};
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats };
    await runPipeline("r", input, f.engines, (l, s, e) => s === "done" && (notes[l] = e), root);
    return { ...f, notes, root };
  };
  const bad = (problems: string[] = ["rain"], flags = ["invented"]): Verdict => ({ fail: true, flags, problems });

  it("passing checks: one agy call per step, notes say pass", async () => {
    const { calls, avoids, judged, notes } = await run([]);
    expect(calls).toMatchObject({ clean: 1, fill: 1 });
    expect(avoids).toEqual([undefined, undefined]);
    expect(judged).toEqual(["clean", "final"]);
    expect(notes["clean card 1 check"]).toBe("pass");
    expect(notes["binder check"]).toBe("pass");
  });

  it("final judge gets full, raw, then crops; a seam fail retries with avoid and keeps needs review", async () => {
    const { judgedFiles, calls, avoids, notes } = await run([pass, bad(["hard edge"], ["seam"]), bad(["still"], ["seam"])]);
    expect(judgedFiles[1]).toEqual(["binder.full.png", "binder.raw.png", "binder.crop1.png"]);
    expect(judgedFiles[2]).toEqual(["binder.full2.png", "binder.raw2.png", "binder.crop21.png"]);
    expect(calls.fill).toBe(2);
    expect(avoids.at(-1)).toEqual(["hard edge"]);
    expect(notes["binder check"]).toBe("needs review: seam");
  });

  it("failing clean retries once with avoid and the retry is passed on", async () => {
    const { calls, avoids, notes, cleanFrameArgs } = await run([bad(["rain", "night"]), pass]);
    expect(calls.clean).toBe(2);
    expect(avoids[1]).toEqual(["rain", "night"]);
    expect(notes["clean card 1 check"]).toBe("pass after retry");
    expect((await sharp(cleanFrameArgs[0][0]).stats()).channels[0].mean).toBeGreaterThan(200); // red
  });

  it("failing fill retries; fewer flags wins, tie goes to the retry", async () => {
    const worse = await run([pass, bad(["a"], ["scale", "seam"]), bad(["b"], ["scale"])]);
    expect(worse.calls.fill).toBe(2);
    expect(worse.notes["binder check"]).toBe("needs review: scale");
    const tie = await run([pass, bad(["a"], ["scale"]), bad(["b"], ["scale"])]);
    const first = await run([pass, bad(["a"], ["scale"]), bad(["b"], ["scale", "smear"])]);
    // bg handed to figma is the one kept: red when the retry won
    const mean = async (r: typeof tie) => (await sharp(path.join(r.root, "output", "r", "output_a_binder.png")).extract({ left: 0, top: 0, width: 50, height: 50 }).stats()).channels[0].mean;
    expect(await mean(tie)).toBeGreaterThan(200);
    expect(await mean(first)).toBeLessThan(100);
    expect(first.notes["binder check"]).toBe("needs review: scale");
  }, 60000);

  it("two failing attempts still finish with a needs review note", async () => {
    const { notes, root } = await run([bad(), bad(["again"])]);
    expect(notes["clean card 1 check"]).toBe("needs review: invented");
    expect(existsSync(path.join(root, "output", "r", "run.json"))).toBe(true);
  });

  it("a skipped judge finishes the run with a skipped note and no retry", async () => {
    const { calls, notes } = await run([{ fail: false, flags: [], problems: [], skipped: "claude exited 1" }]);
    expect(calls.clean).toBe(1);
    expect(notes["clean card 1 check"]).toBe("skipped: claude exited 1");
  });

  it("planSteps equals the emitted labels", async () => {
    const bgRef = { name: "r.png", type: "image/png", buf: await img(10, 10, "purple") };
    const inputs: RunInput[] = [
      { cards: [await card("a.png")], cells: [4], formats: ["binder", "toploader"], bgRef },
      { cards: [await card("a.png"), await card("b.png"), await card("c.png")], cells: [4, 5, 3], formats: ["binder"] },
    ];
    for (const input of inputs) {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const seen: string[] = [];
      await runPipeline("rp", input, fakes().engines, (l) => !seen.includes(l) && seen.push(l), root);
      expect(seen).toEqual(planSteps(input));
    }
  }, 60000);

  it("step images: kept retry names the second file, pass names the first", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
    const images: Record<string, string | undefined> = {};
    const input: RunInput = { cards: [await card("a.png")], cells: [4], formats: ["binder"] };
    await runPipeline("ri", input, fakes([bad(["rain"], ["x"]), pass, pass]).engines, (l, s, _e, img) => s === "done" && (images[l] = img), root);
    expect(images["clean card 1"]).toBe("card0.clean.png");
    expect(images["clean card 1 check"]).toBe("card0.clean2.png");
    expect(images["binder canvas"]).toBe("binder.canvas.png");
    expect(images["binder check"]).toBe("binder.bg.png");
  }, 60000);

  describe("clean reuse", () => {
    const cacheFile = (root: string, c: { buf: Buffer }) => path.join(root, ".cache", "clean", `${cardKey(c.buf)}.png`);
    const go = async (f: ReturnType<typeof fakes>, cards: { name: string; type: string; buf: Buffer }[], root: string) => {
      const notes: Record<string, string | undefined> = {};
      const labels: string[] = [];
      const input: RunInput = { cards, cells: cards.map((_, i) => i), formats: ["binder"] };
      await runPipeline("rr", input, f.engines, (l, s, e) => {
        if (s === "running") labels.push(l);
        if (s === "done") notes[l] = e;
      }, root);
      return { notes, labels, input };
    };

    it("key depends on the prompt", async () => {
      const c = await card("a.png");
      expect(cardKey(c.buf)).toMatch(/^[0-9a-f]{16}$/);
      expect(cardKey(c.buf)).toBe(cardKey(c.buf, CLEAN_PROMPT));
      expect(cardKey(c.buf, CLEAN_PROMPT + "x")).not.toBe(cardKey(c.buf));
    });

    it("second run hits the local cache and calls nothing", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const c = await card("a.png");
      await go(fakes(), [c], root);
      const f = fakes();
      const { notes } = await go(f, [c], root);
      expect(f.calls.clean).toBe(0);
      expect(f.judged).not.toContain("clean");
      expect(f.find.calls).toBe(0);
      expect(notes["clean card 1"]).toBe("reused from cache");
      expect(notes["clean card 1 check"]).toBe("skipped: reused");
      expect(f.cleanFrameKeys[0]).toEqual([cardKey(c.buf)]);
      expect(existsSync(path.join(root, ".work", "rr", "card0.clean.png"))).toBe(true);
    }, 60000);

    it("local miss, Figma hit: no clean or judge, cache written", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const c = await card("a.png");
      const f = fakes();
      f.find.result = { [cardKey(c.buf)]: await img(750, 1050, "blue") };
      const { notes } = await go(f, [c], root);
      expect(f.calls.clean).toBe(0);
      expect(f.judged).not.toContain("clean");
      expect(notes["clean card 1"]).toBe("reused from Figma");
      expect(existsSync(cacheFile(root, c))).toBe(true);
    }, 60000);

    it("both miss, clean passes: cleaned, judged, cached and keyed", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const c = await card("a.png");
      const f = fakes();
      await go(f, [c], root);
      expect(f.calls.clean).toBe(1);
      expect(f.judged).toContain("clean");
      expect(existsSync(cacheFile(root, c))).toBe(true);
      expect(f.cleanFrameKeys[0]).toEqual([cardKey(c.buf)]);
    }, 60000);

    it("cache write goes via a pid tmp file and leaves only <key>.png", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const c = await card("a.png");
      await go(fakes(), [c], root);
      expect(await readdir(path.join(root, ".cache", "clean"))).toEqual([`${cardKey(c.buf)}.png`]);
      // a directory squatting on the tmp path makes the tmp write fail: no direct write to .png, run still finishes
      const root2 = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      await mkdir(path.join(root2, ".cache", "clean", `${cardKey(c.buf)}.${process.pid}.tmp`), { recursive: true });
      const f = fakes();
      const { notes } = await go(f, [c], root2);
      expect(f.calls.clean).toBe(1);
      expect(notes).toHaveProperty(["clean card 1"]);
      expect(existsSync(cacheFile(root2, c))).toBe(false);
    }, 60000);

    it("needs review (or unchecked): no cache, no key", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const c = await card("a.png");
      const bad: Verdict = { fail: true, flags: ["invented"], problems: ["x"] };
      const f = fakes([bad, bad]);
      await go(f, [c], root);
      expect(existsSync(cacheFile(root, c))).toBe(false);
      expect(f.cleanFrameKeys[0]).toEqual([undefined]);
      const root2 = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const g = fakes([{ fail: false, flags: [], problems: [], skipped: "no verdict" }]);
      await go(g, [c], root2);
      expect(existsSync(cacheFile(root2, c))).toBe(false);
    }, 60000);

    it("findCleans throwing falls back to cleaning", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const f = fakes();
      f.find.throws = true;
      await go(f, [await card("a.png")], root);
      expect(f.calls.clean).toBe(1);
    }, 60000);

    it("mixed cards: only the new card is cleaned, labels equal planSteps", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
      const a = await card("a.png");
      await go(fakes(), [a], root);
      const raw = Buffer.alloc(736 * 1024 * 3, 9);
      const b = { name: "b.png", type: "image/png", buf: await sharp(raw, { raw: { width: 736, height: 1024, channels: 3 } }).png().toBuffer() };
      const f = fakes();
      const { labels, input } = await go(f, [a, b], root);
      expect(f.calls.clean).toBe(1);
      expect(f.find.calls).toBe(1);
      expect(new Set(labels)).toEqual(new Set(planSteps(input)));
    }, 60000);
  });
});
