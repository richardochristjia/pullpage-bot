import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { padTo34, unpadFrom34 } from "../imaging";
import { CLEAN_PROMPT, FILL_PROMPT, type Engines, type FillExtra } from "./types";

type SpawnFn = typeof nodeSpawn;

// agy bills the paid API if these keys are present, so never pass them on.
export function agyEnv(env: Record<string, string | undefined>) {
  const { GEMINI_API_KEY: _g, GOOGLE_API_KEY: _k, ...rest } = env;
  return rest;
}

// Canvas fills ran past 4m40s; agy waits for the turn ("0s") and our timer is the only cap.
export function runAgy(cwd: string, prompt: string, timeoutMs = 900_000, spawn: SpawnFn = nodeSpawn) {
  return new Promise<string>((resolve, reject) => {
    const opts: SpawnOptions = { cwd, env: agyEnv(process.env) as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] };
    const child = spawn(
      "agy",
      ["-p", prompt, "--mode", "accept-edits", "--sandbox", "--print-timeout", "0s"],
      opts,
    );
    let err = "";
    let out = "";
    // read stdout: an undrained pipe fills at 64KB and stalls agy; keep only the tail
    child.stdout?.on("data", (d) => (out = (out + d).slice(-4000)));
    child.stderr?.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("agy timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`agy exited ${code}: ${err.slice(-500)}`));
    });
  });
}

async function readOutput(dir: string) {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    try {
      const buf = await readFile(path.join(dir, `out.${ext}`));
      await sharp(buf).metadata();
      return buf;
    } catch {}
  }
}

type CheckFn = (pngPath: string) => Promise<string[]>;

// macOS Vision OCR via swift; lines with under 3 letters (star specks, stray digits) are not text.
export function findText(pngPath: string, spawn: SpawnFn = nodeSpawn): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "src/lib/engines/ocr.swift");
    const child = spawn("swift", [script, pngPath], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err = (err + d).slice(-500)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out.split("\n").filter((l) => /[A-Za-z]{3,}/.test(l)))
        : reject(new Error(`ocr exited ${code}: ${err}`)),
    );
  });
}

async function editImage(step: string, inPath: string, outPath: string, instruction: string, spawn: SpawnFn, check: CheckFn, avoid: string[] = [], extra?: FillExtra) {
  const src = await readFile(inPath);
  const { width, height } = await sharp(src).metadata();
  const { buf, box } = await padTo34(src, width!, height!);
  const dir = `${outPath}.agy`;
  await mkdir(dir, { recursive: true });
  // agy returns 896x1200 whatever it is given, so a bigger input only slows the call.
  await writeFile(path.join(dir, "in.png"), await sharp(buf).resize(896, 1200, { fit: "fill" }).png().toBuffer());
  if (extra?.ref) await writeFile(path.join(dir, "ref.png"), await sharp(extra.ref).png().toBuffer());
  const refLine = extra?.ref ? " Pass ./ref.png to the image generation tool as a second input image; it is a reference only, never copy its text." : "";
  const userLine = extra?.prompt ? ` Additional instruction from the user: ${extra.prompt}` : "";
  const prompt =
    `Use your image generation tool to edit the image ./in.png with this instruction, then save the result in this folder as out.png, and reply with the saved path. Do not use any API key. Do not upscale the result yourself. Generate exactly one image: no retries, variations or extra attempts. If the image generation tool fails, stop and reply with the error: never edit or create the image with code, scripts or any other tool. Instruction: ${instruction}${refLine}${userLine}${avoid.length ? ` Avoid: ${avoid.join("; ")}.` : ""}`;
  for (let attempt = 1; ; attempt++) {
    const reply = await runAgy(dir, prompt, undefined, spawn);
    const out = await readOutput(dir);
    if (!out) {
      // agy exits 0 with no file when the Pro image quota is used up
      const quota = /exhausted|quota|RESOURCE_EXHAUSTED|429/i.test(reply);
      throw new Error(
        quota
          ? `${step}: Google AI Pro image quota used up, try again later. agy said: ${reply.trim().slice(-300)}`
          : `${step}: agy returned no image. agy said: ${reply.trim().slice(-300)}`,
      );
    }
    // check a temp file so a failing attempt never leaves outPath written
    const tmp = `${outPath}.check.png`;
    await writeFile(tmp, await unpadFrom34(out, box));
    const lines = await check(tmp).catch(async (e) => (await rm(tmp, { force: true }), Promise.reject(e)));
    if (!lines.length) {
      await rename(tmp, outPath);
      return;
    }
    await rm(tmp, { force: true });
    if (attempt === 2) throw new Error(`${step}: text left on image after retry: "${lines[0]}"`);
    for (const ext of ["png", "jpg", "jpeg", "webp"]) await rm(path.join(dir, `out.${ext}`), { force: true });
  }
}

export function agyEngines(spawn: SpawnFn = nodeSpawn, check: CheckFn = findText): Pick<Engines, "clean" | "fill"> {
  return {
    clean: (i, o, avoid) => editImage("clean", i, o, CLEAN_PROMPT, spawn, check, avoid),
    fill: (i, o, avoid, extra) => editImage("fill", i, o, FILL_PROMPT, spawn, check, avoid, extra),
  };
}
