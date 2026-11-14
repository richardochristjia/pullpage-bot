import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { readWorkFile } from "./work";

it("serves allow-listed files only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pp-"));
  const id = crypto.randomUUID();
  await mkdir(path.join(root, ".work", id), { recursive: true });
  for (const f of ["card0.clean2.png", "binder.bg.png", "card9.png", "run.json", "card0.PNG"]) await writeFile(path.join(root, ".work", id, f), "x");
  await writeFile(path.join(root, ".work", "run.json"), "x");
  await mkdir(path.join(root, ".work", "evil"));
  await writeFile(path.join(root, ".work", "evil", "binder.bg.png"), "x");
  await writeFile(path.join(root, ".work", "binder.bg.png"), "x");
  expect(await readWorkFile(root, id, "card0.clean2.png")).toEqual(Buffer.from("x"));
  expect(await readWorkFile(root, id, "binder.bg.png")).not.toBeNull();
  for (const f of ["../run.json", "%2e%2e/x", "card9.png", "card0.PNG", "run.json", "toploader.bg.png"]) expect(await readWorkFile(root, id, f)).toBeNull();
  expect(await readWorkFile(root, "..", "binder.bg.png")).toBeNull();
  expect(await readWorkFile(root, "not-an-id", "binder.bg.png")).toBeNull();
  expect(await readWorkFile(root, "evil", "binder.bg.png")).toBeNull();
  expect(await readWorkFile(root, ".", "binder.bg.png")).toBeNull();
});
