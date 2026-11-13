import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { listRuns } from "./approve";
import { exportLink, findLinkPdf, parseFrameLink } from "./links";

const base = "https://www.figma.com/design/KEY/Name";

describe("parseFrameLink", () => {
  it("accepts design, file and branch links", () => {
    expect(parseFrameLink(`${base}?node-id=12-3`, "KEY")).toEqual({ fileKey: "KEY", nodeId: "12:3" });
    expect(parseFrameLink(" https://figma.com/file/KEY/x?node-id=12%3A3 ", "KEY").nodeId).toBe("12:3");
    expect(parseFrameLink("https://www.figma.com/design/OLD/branch/KEY/x?node-id=1-2", "KEY").fileKey).toBe("KEY");
  });

  it("rejects foreign key, missing node-id, other host, garbage", () => {
    expect(() => parseFrameLink(`${base}?node-id=1-2`, "OTHER")).toThrow("Not the configured Figma file.");
    expect(() => parseFrameLink(base, "KEY")).toThrow("Link has no frame node-id.");
    expect(() => parseFrameLink("https://example.com/design/KEY/x?node-id=1-2", "KEY")).toThrow("Not a Figma link.");
    expect(() => parseFrameLink("nope", "KEY")).toThrow("Not a link.");
    expect(() => parseFrameLink(`${base}?node-id=1-2`, "")).toThrow("FIGMA_FILE_KEY is not set.");
  });
});

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#123456" } }).png().toBuffer();

async function exportWith(root: string, read: object, size: [number, number], url = `${base}?node-id=7-8`) {
  const img = await png(size[0], size[1]);
  const deps = {
    claude: async (p: string) => (p.includes("download_assets") ? '{"exportUrl":"http://x/y.png"}' : JSON.stringify(read)),
    fetch: (async () => ({ ok: true, arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.byteLength) })) as unknown as typeof fetch,
    fileKey: "KEY",
  };
  return exportLink(root, url, deps);
}
const root = () => mkdtemp(path.join(os.tmpdir(), "links-"));
const pagesOf = async (r: string, node = "7-8") => {
  const f = (await readdir(path.join(r, "output", "links", node))).filter((n) => n.endsWith(".pdf"));
  return { f, doc: await PDFDocument.load(await readFile(path.join(r, "output", "links", node, f[0]))) };
};

describe("exportLink", () => {
  it("binder with cells 3,4,5 missing gives a 6-page PDF in output/links/<node>", async () => {
    const r = await root();
    const out = await exportWith(r, { w: 2578, h: 3478, name: "cut_output_g_binder", cells: [0, 1, 2, 6, 7, 8] }, [2578, 3478]);
    expect(out).toEqual({ pdf: "/api/links/pdf?node=7-8", format: "binder", pages: 6 });
    const { f, doc } = await pagesOf(r);
    expect(f).toEqual(["output_g_binder binder.pdf"]);
    expect(doc.getPageCount()).toBe(6);
    expect(await listRuns(r)).toEqual([]);
  });

  it("wrong PNG size throws and writes nothing", async () => {
    const r = await root();
    await expect(exportWith(r, { w: 2578, h: 3478, name: "cut_a", cells: [0, 1, 2, 6, 7, 8] }, [100, 100])).rejects.toThrow();
    expect(existsSync(path.join(r, "output"))).toBe(false);
  });

  it("rejects non-cut sizes and layout mismatches", async () => {
    const r = await root();
    await expect(exportWith(r, { w: 2252, h: 3152, name: "x", cells: [] }, [2252, 3152])).rejects.toThrow("not a cut frame: 2252x3152");
    await expect(exportWith(r, { w: 3028, h: 3928, name: "x", cells: [0, 1, 2, 3, 4, 5, 6, 7] }, [3028, 3928])).rejects.toThrow("do not match the layout");
    await expect(exportWith(r, { w: 2578, h: 3478, name: "x", cells: [] }, [2578, 3478])).rejects.toThrow("do not match the layout");
  });

  it("re-export after a rename removes the old PDF", async () => {
    const r = await root();
    const read = { w: 3028, h: 3928, cells: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
    await exportWith(r, { ...read, name: "cut_old" }, [3028, 3928]);
    await exportWith(r, { ...read, name: "cut_new" }, [3028, 3928]);
    const { f, doc } = await pagesOf(r);
    expect(f).toEqual(["new toploader.pdf"]);
    expect(doc.getPageCount()).toBe(9);
    expect((await findLinkPdf(r, "7-8"))?.file).toBe("new toploader.pdf");
    expect(await findLinkPdf(r, "../x")).toBeNull();
  });
});
