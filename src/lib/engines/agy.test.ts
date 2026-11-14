import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { agyEngines, agyEnv, findText, runAgy } from "./agy";
import { CLEAN_PROMPT, FILL_PROMPT } from "./types";

const noText = async () => [] as string[];

function fakeSpawn(onRun?: (cwd: string) => Promise<void>) {
  const calls: { args: string[]; opts: any }[] = [];
  const spawn = ((cmd: string, args: string[], opts: any) => {
    calls.push({ args, opts });
    const child: any = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    onRun?.(opts.cwd).then(() => child.emit("close", 0));
    if (!onRun) setImmediate(() => child.emit("close", 0));
    return child;
  }) as any;
  return { spawn, calls };
}

describe("agy", () => {
  it("agyEnv strips both keys and keeps others", () => {
    const env = agyEnv({ GEMINI_API_KEY: "a", GOOGLE_API_KEY: "b", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("runAgy spawns without API keys", async () => {
    process.env.GEMINI_API_KEY = "x";
    process.env.GOOGLE_API_KEY = "y";
    const { spawn, calls } = fakeSpawn();
    await runAgy("/tmp", "hi", 1000, spawn);
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(calls[0].opts.cwd).toBe("/tmp");
    expect(calls[0].opts.env.GEMINI_API_KEY).toBeUndefined();
    expect(calls[0].opts.env.GOOGLE_API_KEY).toBeUndefined();
    expect(calls[0].args.slice(0, 2)).toEqual(["-p", "hi"]);
  });

  it("missing output file throws with the step name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-"));
    const inp = path.join(dir, "in.png");
    await writeFile(inp, await sharp({ create: { width: 750, height: 1050, channels: 3, background: "red" } }).png().toBuffer());
    const { spawn } = fakeSpawn();
    await expect(agyEngines(spawn, noText).clean(inp, path.join(dir, "o.png"))).rejects.toThrow("clean: agy returned no image");
  });

  it("names the quota when agy exits 0 with no image after a quota error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-"));
    const inp = path.join(dir, "in.png");
    await writeFile(inp, await sharp({ create: { width: 750, height: 1050, channels: 3, background: "red" } }).png().toBuffer());
    const spawn = (() => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        child.stdout.emit("data", "You have exhausted your capacity on this model.");
        child.emit("close", 0);
      });
      return child;
    }) as any;
    await expect(agyEngines(spawn, noText).fill(inp, path.join(dir, "o.png"))).rejects.toThrow("fill: Google AI Pro image quota used up");
  });

  it("clean returns 750x1050 from a 896x1200 agy output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-"));
    const inp = path.join(dir, "in.png");
    const outp = path.join(dir, "o.png");
    await writeFile(inp, await sharp({ create: { width: 750, height: 1050, channels: 3, background: "red" } }).png().toBuffer());
    const { spawn } = fakeSpawn(async (cwd) => {
      await writeFile(path.join(cwd, "out.jpg"), await sharp({ create: { width: 896, height: 1200, channels: 3, background: "blue" } }).jpeg().toBuffer());
    });
    await agyEngines(spawn, noText).clean(inp, outp);
    const m = await sharp(await readFile(outp)).metadata();
    expect([m.width, m.height]).toEqual([750, 1050]);
  });

  async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-"));
    const inp = path.join(dir, "in.png");
    await writeFile(inp, await sharp({ create: { width: 750, height: 1050, channels: 3, background: "red" } }).png().toBuffer());
    const { spawn, calls } = fakeSpawn(async (cwd) => {
      await writeFile(path.join(cwd, "out.png"), await sharp({ create: { width: 896, height: 1200, channels: 3, background: "blue" } }).png().toBuffer());
    });
    const scripted = (...results: string[][]) => {
      const seen: string[] = [];
      return { seen, check: async (p: string) => (seen.push(p), results.shift() ?? []) };
    };
    return { inp, outp: path.join(dir, "o.png"), spawn, calls, scripted };
  }
  const exists = (p: string) => readFile(p).then(() => true, () => false);

  it("prompts match the spec", () => {
    expect(CLEAN_PROMPT).toContain("keep the art window's exact color palette, brightness, lighting, weather and time of day");
    expect(CLEAN_PROMPT).toContain("Do not add rain, fog, night, buildings or any scenery that the art window does not already show.");
    expect(FILL_PROMPT.endsWith(" The new background must contain no text, letters, numbers, symbols, logos or watermarks.")).toBe(true);
  });

  it("clean first try: one agy call, file written", async () => {
    const { inp, outp, spawn, calls, scripted } = await setup();
    const { check } = scripted([]);
    await agyEngines(spawn, check).clean(inp, outp);
    expect(calls).toHaveLength(1);
    expect(await exists(outp)).toBe(true);
  });

  it("clean prompt reaches agy; Avoid appended only when given", async () => {
    const { inp, outp, spawn, calls, scripted } = await setup();
    const { check } = scripted([], []);
    await agyEngines(spawn, check).clean(inp, outp);
    await agyEngines(spawn, check).clean(inp, outp, ["rain on the left", "night sky"]);
    expect(calls[0].args[1]).toContain(CLEAN_PROMPT);
    expect(calls[0].args[1]).not.toContain("Avoid:");
    expect(calls[1].args[1]).toContain(`${CLEAN_PROMPT} Avoid: rain on the left; night sky.`);
  });

  it("fill without extra is unchanged; with extra writes ref.png and orders the prompt; clean ignores extra", async () => {
    const { inp, outp, spawn, calls, scripted } = await setup();
    const { check } = scripted([], [], [], []);
    const ref = path.join(path.dirname(inp), "myref.jpg");
    await writeFile(ref, await sharp({ create: { width: 20, height: 20, channels: 3, background: "purple" } }).jpeg().toBuffer());
    await agyEngines(spawn, check).fill(inp, outp);
    expect(calls[0].args[1]).toContain(`Instruction: ${FILL_PROMPT}`);
    expect(calls[0].args[1]).not.toContain("ref.png");
    expect(await exists(`${outp}.agy/ref.png`)).toBe(false);
    await agyEngines(spawn, check).fill(inp, outp, ["x"], { prompt: "stars", ref });
    const p = calls[1].args[1];
    const at = [FILL_PROMPT, "./ref.png", "Additional instruction from the user: stars", "Avoid: x."].map((t) => p.indexOf(t));
    expect(at.every((n) => n >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
    expect(await exists(`${outp}.agy/ref.png`)).toBe(true);
    await (agyEngines(spawn, check).clean as any)(inp, outp, undefined, { prompt: "stars", ref });
    expect(calls[2].args[1]).not.toContain("stars");
  });

  it("text then clean: two agy calls, file written", async () => {
    const { inp, outp, spawn, calls, scripted } = await setup();
    const { check } = scripted(["Espeon"], []);
    await agyEngines(spawn, check).clean(inp, outp);
    expect(calls).toHaveLength(2);
    expect(await exists(outp)).toBe(true);
  });

  it("text on both tries throws and writes nothing", async () => {
    const { inp, outp, spawn, calls, scripted } = await setup();
    const { check } = scripted(["Espeon"], ["Weakness"]);
    await expect(agyEngines(spawn, check).fill(inp, outp)).rejects.toThrow('fill: text left on image after retry: "Weakness"');
    expect(calls).toHaveLength(2);
    expect(await exists(outp)).toBe(false);
  });

  it("no image: existing error, check never called", async () => {
    const { inp, outp, scripted } = await setup();
    const { check, seen } = scripted();
    await expect(agyEngines(fakeSpawn().spawn, check).clean(inp, outp)).rejects.toThrow("clean: agy returned no image");
    expect(seen).toHaveLength(0);
  });

  it("findText drops lines under 3 letters", async () => {
    const spawn = ((_c: string, _a: string[], _o: any) => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stdout.emit("data", "*\n10\nEspeon\n");
        child.emit("close", 0);
      });
      return child;
    }) as any;
    expect(await findText("x.png", spawn)).toEqual(["Espeon"]);
  });

  it("does not stall when agy prints more than a pipe buffer to stdout", async () => {
    const spawn = ((_c: string, _a: string[], o: any) =>
      nodeSpawn("node", ["-e", "process.stdout.write('x'.repeat(4e6))"], o)) as any;
    await runAgy(os.tmpdir(), "p", 4000, spawn);
  });
});
