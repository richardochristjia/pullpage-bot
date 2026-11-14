import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CANVAS, cardRect } from "./geometry";
import { padTo34, toCard, unpadFrom34 } from "./imaging";
import { displayName, runPipeline, validateRun, type RunInput } from "./pipeline";
import type { Engines, Verdict } from "./engines/types";

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
  const cleanFrameArgs: Buffer[][] = [];
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
    async judge(kind) {
      judged.push(kind);
      return verdicts.shift() ?? pass;
    },
    async cleanFrame(i) {
      calls.cleanFrame++;
      cleanFrameArgs.push(i.cleaned);
      return { frameId: "9:9" };
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
  return { engines, calls, cleanFrameArgs, avoids, judged };
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
});
