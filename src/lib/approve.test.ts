import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { approveFormat, cutFormat, listRuns, readMeta } from "./approve";
import { cutFrameSize } from "./cut";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const setup = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "approve-"));
  await mkdir(path.join(root, "output", ID), { recursive: true });
  const meta = { id: ID, name: "Goldeen AR", slug: "goldeen-ar", cells: [4], fileKey: "K", createdAt: "x", formats: { binder: { frameId: "1:2", cutFrameId: "5:6" } } };
  await writeFile(path.join(root, "output", ID, "run.json"), JSON.stringify(meta));
  return root;
};
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#123456" } }).png().toBuffer();

describe("approveFormat guards", () => {
  it("returns 404 for bad id, unknown run, bad format, and unlisted format", async () => {
    const root = await setup();
    const ex = async () => {
      throw new Error("must not export");
    };
    const unknown = "123e4567-e89b-42d3-a456-426614174999";
    for (const [id, f] of [["../x", "binder"], [unknown, "binder"], [ID, "nope"], [ID, "toploader"]])
      expect((await approveFormat(root, id, f, ex)).status).toBe(404);
    expect(await readMeta(root, "../x")).toBeNull();
  });

  it("returns 409 for an overlapping call", async () => {
    const root = await setup();
    let release!: (b: Buffer) => void;
    const first = approveFormat(root, ID, "binder", () => new Promise<Buffer>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 20));
    expect(await approveFormat(root, ID, "binder", async () => png(1, 1))).toMatchObject({ status: 409 });
    release(await png(cutFrameSize("binder").w, cutFrameSize("binder").h));
    expect((await first).status).toBe(200);
  });
});

describe("cut then PDF", () => {
  const noCut = async () => {
    const root = await setup();
    const p = path.join(root, "output", ID, "run.json");
    const m = JSON.parse(await readFile(p, "utf8"));
    m.formats.binder = { frameId: "1:2", approvedAt: "old" };
    await writeFile(p, JSON.stringify(m));
    return root;
  };
  it("409 without a cut and writes no PDF", async () => {
    const root = await noCut();
    const ex = async () => {
      throw new Error("must not export");
    };
    expect(await approveFormat(root, ID, "binder", ex)).toEqual({ status: 409, error: "Cut to Figma first." });
    expect(await readdir(path.join(root, "output", ID))).toEqual(["run.json"]);
  });
  it("cut saves cutFrameId and clears approvedAt, then PDF works", async () => {
    const root = await noCut();
    const r = await cutFormat(root, ID, "binder", async (k, fid, f, cells, name, old) => {
      expect([k, fid, f, cells, name, old]).toEqual(["K", "1:2", "binder", [4], "goldeen-ar", undefined]);
      return "7:8";
    });
    expect(r).toEqual({ status: 200, figmaUrl: "https://www.figma.com/design/K/?node-id=7-8" });
    expect((await readMeta(root, ID))?.formats.binder).toEqual({ frameId: "1:2", cutFrameId: "7:8" });
    expect((await approveFormat(root, ID, "binder", async () => png(cutFrameSize("binder").w, cutFrameSize("binder").h))).status).toBe(200);
    expect((await listRuns(root))[0].formats).toEqual([{ format: "binder", cut: true, approved: true }]);
  });
  it("concurrent cuts of two formats on one run lose no cutFrameId", async () => {
    const root = await setup();
    const p = path.join(root, "output", ID, "run.json");
    const m = JSON.parse(await readFile(p, "utf8"));
    m.formats.toploader = { frameId: "3:4" };
    await writeFile(p, JSON.stringify(m));
    const ids = { binder: "9:1", toploader: "9:2" };
    const results = await Promise.all((["binder", "toploader"] as const).map((f, i) =>
      cutFormat(root, ID, f, () => new Promise<string>((r) => setTimeout(() => r(ids[f]), i ? 0 : 30)))));
    const saved = (await readMeta(root, ID))!.formats;
    (["binder", "toploader"] as const).forEach((f, i) => { if (results[i].status === 200) expect(saved[f]?.cutFrameId).toBe(ids[f]); });
  });
  it("re-cut after a PDF lists the format as not approved", async () => {
    const root = await setup();
    await approveFormat(root, ID, "binder", async () => png(cutFrameSize("binder").w, cutFrameSize("binder").h));
    await cutFormat(root, ID, "binder", async () => "7:7");
    expect((await listRuns(root))[0].formats).toEqual([{ format: "binder", cut: true, approved: false }]);
  });
  it("cut guards: 404s, 409 on overlap, 500 on cutter error", async () => {
    const root = await setup();
    const c = async () => "1:1";
    const unknown = "123e4567-e89b-42d3-a456-426614174999";
    for (const [id, f] of [["../x", "binder"], [unknown, "binder"], [ID, "nope"], [ID, "toploader"]])
      expect((await cutFormat(root, id, f, c)).status).toBe(404);
    let release!: (s: string) => void;
    const first = cutFormat(root, ID, "binder", () => new Promise<string>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 20));
    expect(await cutFormat(root, ID, "binder", c)).toMatchObject({ status: 409 });
    release("2:2");
    expect((await first).status).toBe(200);
    expect((await cutFormat(root, ID, "binder", async () => { throw new Error("boom"); })).status).toBe(500);
  });
});

describe("approveFormat", () => {
  it("writes approved png, pdf and approvedAt", async () => {
    const root = await setup();
    const r = await approveFormat(root, ID, "binder", async (k, fid) => {
      expect([k, fid]).toEqual(["K", "5:6"]);
      return png(cutFrameSize("binder").w, cutFrameSize("binder").h);
    });
    expect(r).toEqual({ status: 200, pdf: `/api/runs/${ID}/pdf?format=binder` });
    const files = await readdir(path.join(root, "output", ID));
    expect(files).toEqual(expect.arrayContaining(["output_goldeen-ar_binder.approved.png", "Goldeen AR binder.pdf"]));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect((await readMeta(root, ID))?.formats.binder?.approvedAt).toBeTruthy();
  });

  it("wrong-size export gives 500 and writes no pdf", async () => {
    const root = await setup();
    const r = await approveFormat(root, ID, "binder", async () => png(2577, 3478));
    expect(r.status).toBe(500);
    expect(await readdir(path.join(root, "output", ID))).toEqual(["run.json"]);
    expect(JSON.parse(await readFile(path.join(root, "output", ID, "run.json"), "utf8")).formats.binder.approvedAt).toBeUndefined();
  });
});

describe("listRuns", () => {
  it("shows approved only after approve, skipping unreadable runs", async () => {
    const root = await setup();
    await mkdir(path.join(root, "output", "junk"), { recursive: true });
    expect(await listRuns(root)).toEqual([{ id: ID, name: "Goldeen AR", createdAt: "x", formats: [{ format: "binder", cut: true, approved: false }] }]);
    await approveFormat(root, ID, "binder", async () => png(cutFrameSize("binder").w, cutFrameSize("binder").h));
    expect((await listRuns(root))[0].formats).toEqual([{ format: "binder", cut: true, approved: true }]);
  });
});
