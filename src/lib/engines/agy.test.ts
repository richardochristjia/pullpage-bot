import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { agyEngines, agyEnv, runAgy } from "./agy";

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
    await expect(agyEngines(spawn).clean(inp, path.join(dir, "o.png"))).rejects.toThrow("clean: agy returned no image");
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
    await expect(agyEngines(spawn).fill(inp, path.join(dir, "o.png"))).rejects.toThrow("fill: Google AI Pro image quota used up");
  });

  it("clean returns 750x1050 from a 896x1200 agy output", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agy-"));
    const inp = path.join(dir, "in.png");
    const outp = path.join(dir, "o.png");
    await writeFile(inp, await sharp({ create: { width: 750, height: 1050, channels: 3, background: "red" } }).png().toBuffer());
    const { spawn } = fakeSpawn(async (cwd) => {
      await writeFile(path.join(cwd, "out.jpg"), await sharp({ create: { width: 896, height: 1200, channels: 3, background: "blue" } }).jpeg().toBuffer());
    });
    await agyEngines(spawn).clean(inp, outp);
    const m = await sharp(await readFile(outp)).metadata();
    expect([m.width, m.height]).toEqual([750, 1050]);
  });

  it("does not stall when agy prints more than a pipe buffer to stdout", async () => {
    const spawn = ((_c: string, _a: string[], o: any) =>
      nodeSpawn("node", ["-e", "process.stdout.write('x'.repeat(4e6))"], o)) as any;
    await runAgy(os.tmpdir(), "p", 4000, spawn);
  });
});
