import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { Engines } from "./engines/types";
import { activeRunId, getRun, startRun } from "./runs";
import { planSteps } from "./steps";

const engines: Engines = {
  clean: async (i, o) => writeFile(o, await readFile(i)),
  fill: async (i, o) => writeFile(o, await readFile(i)),
  judge: async () => ({ fail: false, flags: [], problems: [] }),
  cleanFrame: async () => ({ frameId: "9:9" }),
  figma: async (inp) => {
    const pngPath = path.join(inp.workDir, "fake.png");
    await writeFile(pngPath, inp.bg);
    return { url: "https://figma/x", pngPath, frameId: "1:1" };
  },
};

it("seeds pending steps, stamps times, tracks the active run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
  const buf = await sharp({ create: { width: 736, height: 1024, channels: 3, background: "blue" } }).png().toBuffer();
  const input = { cards: [{ name: "a.png", type: "image/png", buf }], cells: [4], formats: ["binder" as const] };
  const id = startRun(input, engines, root);
  const run = getRun(id)!;
  expect(run.steps.map((s) => [s.label, s.status])).toEqual(planSteps(input).map((l) => [l, "pending"]));
  expect(activeRunId()).toBe(id);
  expect(run.cards).toEqual(["a"]);
  for (let i = 0; i < 200 && run.status === "running"; i++) await new Promise((r) => setTimeout(r, 50));
  expect(run.status).toBe("done");
  expect(activeRunId()).toBeUndefined();
  for (const s of run.steps) {
    expect(s.status).toBe("done");
    expect(s.startedAt!).toBeLessThanOrEqual(s.endedAt!);
  }
  expect(run.steps.find((s) => s.label === "binder background")!.image).toBe("binder.bg.png");
}, 30000);
