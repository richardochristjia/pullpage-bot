import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { approveFormat, listRuns, readMeta } from "./approve";
import { cutFrameSize } from "./cut";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const setup = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "approve-"));
  await mkdir(path.join(root, "output", ID), { recursive: true });
  const meta = { id: ID, name: "Goldeen AR", slug: "goldeen-ar", cells: [4], fileKey: "K", createdAt: "x", formats: { binder: { frameId: "1:2" } } };
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

describe("approveFormat", () => {
  it("writes approved png, pdf and approvedAt", async () => {
    const root = await setup();
    const r = await approveFormat(root, ID, "binder", async (k, fid) => {
      expect([k, fid]).toEqual(["K", "1:2"]);
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
    expect(await listRuns(root)).toEqual([{ id: ID, name: "Goldeen AR", createdAt: "x", formats: [{ format: "binder", approved: false }] }]);
    await approveFormat(root, ID, "binder", async () => png(cutFrameSize("binder").w, cutFrameSize("binder").h));
    expect((await listRuns(root))[0].formats).toEqual([{ format: "binder", approved: true }]);
  });
});
