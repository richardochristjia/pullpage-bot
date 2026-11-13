import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardRect } from "../geometry";
import { buildFrameScript, exportFrame, extractJson, publishToFigma } from "./figma";

describe("figma", () => {
  it("script has size, page, rects, background before cards", () => {
    const s = buildFrameScript({ name: "g", format: "toploader", cards: [{ cell: 4, label: "a" }] });
    expect(s).toContain("2702, 3602");
    expect(s).toContain('"Automation"');
    expect(s).toContain("output_g_toploader");
    const r = cardRect("toploader", 4);
    expect(s).toContain(JSON.stringify([{ label: "a", ...r }]));
    expect(s.indexOf("background")).toBeLessThan(s.indexOf("cardIds.push"));
  });

  it("extracts JSON from fenced and prose replies", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("nope")).toThrow();
  });

  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "white" } }).png().toBuffer();

  it("throws on duplicate node IDs", async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "fg-"));
    const input = { format: "binder" as const, name: "g", bg: await png(2252, 3152), originals: [{ cell: 4, label: "a", png: await png(750, 1050) }], workDir };
    const claude = async () => '{"frameId":"1:2","uploads":[{"nodeId":"1:3","submitUrl":"u"},{"nodeId":"1:3","submitUrl":"u"}]}';
    await expect(publishToFigma(input, { claude, fetch: fetch, fileKey: "K" })).rejects.toThrow("node IDs mismatch");
  });

  it("never re-sends the frame-creating prompt after a failure", async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "fg-"));
    const input = { format: "binder" as const, name: "g", bg: await png(2252, 3152), originals: [{ cell: 4, label: "a", png: await png(750, 1050) }], workDir };
    const prompts: string[] = [];
    const claude = async (p: string) => {
      prompts.push(p);
      if (prompts.length === 1) throw new Error("claude timed out");
      return '{"frameId":"1:2","uploads":[{"nodeId":"1:3","submitUrl":"u"},{"nodeId":"1:4","submitUrl":"u"}]}';
    };
    await expect(publishToFigma(input, { claude, fetch: fetch, fileKey: "K" })).rejects.toThrow("claude timed out");
    expect(prompts.filter((p) => p.includes("use_figma")).length).toBe(1);
  });

  it("happy path posts uploads and downloads the export", async () => {
    const workDir = await mkdtemp(path.join(os.tmpdir(), "fg-"));
    const input = { format: "binder" as const, name: "g", bg: await png(2252, 3152), originals: [{ cell: 4, label: "a", png: await png(750, 1050) }], workDir };
    const replies = [
      '{"frameId":"1:2","uploads":[{"nodeId":"1:3","submitUrl":"http://up/1"},{"nodeId":"1:4","submitUrl":"http://up/2"}]}',
      "garbage", // download_assets is idempotent, so one unparseable reply is retried
      '{"exportUrl":"http://exp"}',
    ];
    const posted: string[] = [];
    const exported = await png(2252, 3152);
    const fakeFetch = (async (url: string, init?: any) => {
      if (init?.method === "POST") {
        posted.push(url);
        return { json: async () => ({ success: true }) };
      }
      return { ok: true, arrayBuffer: async () => exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.length) };
    }) as any;
    const r = await publishToFigma(input, { claude: async () => replies.shift()!, fetch: fakeFetch, fileKey: "K" });
    expect(posted).toEqual(["http://up/1", "http://up/2"]);
    expect(r.url).toBe("https://www.figma.com/design/K/?node-id=1-2");
    expect(r.frameId).toBe("1:2");
  });

  it("exportFrame retries one garbage reply and returns the PNG", async () => {
    const replies = ["garbage", '{"exportUrl":"http://exp"}'];
    const prompts: string[] = [];
    const exported = await png(2252, 3152);
    const fakeFetch = (async () => ({ ok: true, arrayBuffer: async () => exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.length) })) as any;
    const claude = async (p: string) => (prompts.push(p), replies.shift()!);
    const out = await exportFrame({ claude, fetch: fakeFetch, fileKey: "K" }, "1:2", "binder");
    expect(out.equals(exported)).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('fileKey "K" and nodeId "1:2"');
  });

  it("exportFrame rejects a wrong-size export", async () => {
    const wrong = await png(2251, 3152);
    const fakeFetch = (async () => ({ ok: true, arrayBuffer: async () => wrong.buffer.slice(wrong.byteOffset, wrong.byteOffset + wrong.length) })) as any;
    await expect(exportFrame({ claude: async () => '{"exportUrl":"u"}', fetch: fakeFetch, fileKey: "K" }, "1:2", "binder")).rejects.toThrow(
      "figma: export is 2251x3152, expected 2252x3152",
    );
  });
});
