import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardRect } from "../geometry";
import { cutLayout } from "../cut";
import { buildCleanFrameScript, buildCutScript, buildLinkCutScript, cutLinkInFigma, buildFrameScript, cutToFigma, exportFrame, exportNode, extractJson, judge, runClaude, publishCleanFrame, publishToFigma } from "./figma";

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

  it("buildCutScript drops only card layers, offsets clones, one piece per entry", () => {
    const pieces = cutLayout("binder", [4]);
    const base = { frameId: "1:2", name: "g", format: "binder" as const, pieces, size: { w: 2578, h: 3478 } };
    const js = buildCutScript({ ...base, oldCutFrameId: "9:9" });
    expect(js).toContain("/^card\\d+$/");
    expect(js).toContain('getNodeByIdAsync("9:9")');
    for (const p of pieces) expect(js).toContain(`"cell":${p.cell},"sx":${p.src.x},"sy":${p.src.y},"dx":${p.dst.x},"dy":${p.dst.y}`);
    expect(js.match(/"cell":/g)).toHaveLength(8);
    expect(js).toContain("c.x = -q.sx; c.y = -q.sy;");
    expect(buildCutScript(base)).not.toContain("old");
  });

  it("cutToFigma returns the id and does not retry garbage", async () => {
    const prompts: string[] = [];
    const mk = (r: string) => ({ claude: async (p: string) => (prompts.push(p), r), fetch: fetch, fileKey: "K" });
    expect(await cutToFigma(mk('{"cutFrameId":"5:6"}'), "1:2", "binder", [4], "g")).toBe("5:6");
    prompts.length = 0;
    await expect(cutToFigma(mk("garbage"), "1:2", "binder", [4], "g")).rejects.toThrow();
    expect(prompts).toHaveLength(1);
    await expect(cutToFigma(mk("{}"), "1:2", "binder", [4], "g")).rejects.toThrow("figma: no cutFrameId");
  });

  it("exportNode rejects a wrong-size export", async () => {
    const wrong = await png(10, 10);
    const fakeFetch = (async () => ({ ok: true, arrayBuffer: async () => wrong.buffer.slice(wrong.byteOffset, wrong.byteOffset + wrong.length) })) as any;
    await expect(exportNode({ claude: async () => '{"exportUrl":"u"}', fetch: fakeFetch, fileKey: "K" }, "1:2", 20, 20)).rejects.toThrow(
      "figma: export is 10x10, expected 20x20",
    );
  });

  it("clean frame script names the frame and places count rects", () => {
    const s = buildCleanFrameScript({ name: "g", count: 2 });
    expect(s).toContain("clean_g");
    expect(s).toContain('"Automation"');
    expect(s).toContain("resize(1564, 1050)");
    expect(s).toContain("i < 2");
  });

  it("publishCleanFrame uploads each PNG and rejects a wrong upload count", async () => {
    const posted: string[] = [];
    const fetchFake = (async (u: string) => {
      posted.push(u);
      return { json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    const cleaned = [Buffer.from("a"), Buffer.from("b")];
    const two = '{"frameId":"1:2","uploads":[{"nodeId":"1:3","submitUrl":"u1"},{"nodeId":"1:4","submitUrl":"u2"}]}';
    await expect(publishCleanFrame({ name: "g", cleaned, workDir: "" }, { claude: async () => two, fetch: fetchFake, fileKey: "K" })).resolves.toEqual({ frameId: "1:2" });
    expect(posted).toEqual(["u1", "u2"]);
    const one = '{"frameId":"1:2","uploads":[{"nodeId":"1:3","submitUrl":"u1"}]}';
    await expect(publishCleanFrame({ name: "g", cleaned, workDir: "" }, { claude: async () => one, fetch: fetchFake, fileKey: "K" })).rejects.toThrow("unexpected upload list");
  });

  // Minimal fake of the figma plugin API, enough to run the link cut script body.
  function fakeFigma(src: { w: number; h: number; parent?: string; kids?: { name: string; x: number; y: number }[]; sibling?: string }) {
    const mk = (type: string, name = "") => {
      const n: any = { type, name, children: [], x: 0, y: 0, width: 0, height: 0, parent: null };
      n.resize = (w: number, h: number) => ((n.width = w), (n.height = h));
      n.appendChild = (c: any) => {
        c.parent?.children.splice(c.parent.children.indexOf(c), 1);
        c.parent = n;
        n.children.push(c);
      };
      n.remove = () => (n.parent.children = n.parent.children.filter((c: any) => c !== n));
      n.clone = () => {
        const c = mk(n.type, n.name);
        for (const k of n.children) c.appendChild({ ...k, parent: null, remove: () => (c.children = c.children.filter((x: any) => x.name !== k.name)) });
        return c;
      };
      return n;
    };
    const page = mk(src.parent ?? "PAGE", "Automation");
    const frame = mk("FRAME", "output_g_binder");
    frame.resize(src.w, src.h);
    for (const k of src.kids ?? []) frame.children.push({ ...k, type: "RECTANGLE", parent: frame, remove: () => (frame.children = frame.children.filter((c: any) => c !== k)) });
    page.appendChild(frame);
    if (src.sibling) page.appendChild(mk("FRAME", src.sibling));
    const figma = { getNodeByIdAsync: async () => frame, setCurrentPageAsync: async () => {}, createFrame: () => { const n = mk("FRAME"); page.appendChild(n); return n; }, root: {} };
    return { figma, page };
  }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const runLinkCut = (f: ReturnType<typeof fakeFigma>) => new AsyncFunction("figma", buildLinkCutScript({ nodeId: "1:2" }))(f.figma);

  it("link cut script embeds both formats and the guards", () => {
    const s = buildLinkCutScript({ nodeId: "1:2" });
    expect(s).toContain("2578");
    expect(s).toContain("3028");
    expect(s).toContain('"cut_" + src.name');
    expect(s).toContain("/^card\\d+$/");
    expect(s).toContain('src.parent.type !== "PAGE"');
  });

  it("link cut: binder with a card at cell 4 gives 8 pieces and replaces the old cut", async () => {
    const r = cardRect("binder", 4);
    const f = fakeFigma({ w: 2252, h: 3152, kids: [{ name: "bg", x: 0, y: 0 }, { name: "card1", x: r.x + 1, y: r.y }], sibling: "cut_output_g_binder" });
    const out = await runLinkCut(f);
    expect(out).toMatchObject({ format: "binder", cardCells: [4] });
    const cuts = f.page.children.filter((c: any) => c.name === "cut_output_g_binder");
    expect(cuts).toHaveLength(1);
    expect(cuts[0].children).toHaveLength(8);
    // same fill and clip as the run cut script
    expect(cuts[0].fills).toEqual([{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }]);
    expect(cuts[0].clipsContent).toBe(true);
    for (const p of cuts[0].children) {
      expect(p).toMatchObject({ clipsContent: true, fills: [] });
      expect(p.children[0].children.map((k: any) => k.name)).toEqual(["bg"]);
    }
  });

  it("link cut: a card within 2px counts as a card cell, 3px off does not", async () => {
    const r = cardRect("binder", 4);
    const at = (dx: number) => runLinkCut(fakeFigma({ w: 2252, h: 3152, kids: [{ name: "card1", x: r.x + dx, y: r.y - dx }] }));
    expect((await at(2)).cardCells).toEqual([4]);
    expect((await at(-2)).cardCells).toEqual([4]);
    expect((await at(3)).cardCells).toEqual([]);
  });

  it("link cut: toploader gives 9 pieces; other sizes and non-page parents throw", async () => {
    const f = fakeFigma({ w: 2702, h: 3602 });
    expect((await runLinkCut(f)).format).toBe("toploader");
    expect(f.page.children.find((c: any) => c.name === "cut_output_g_binder").children).toHaveLength(9);
    await expect(runLinkCut(fakeFigma({ w: 800, h: 600 }))).rejects.toThrow("frame is 800x600, not binder or toploader");
    await expect(runLinkCut(fakeFigma({ w: 2252, h: 3152, parent: "SECTION" }))).rejects.toThrow("directly on a page");
  });

  it("cutLinkInFigma makes one Claude call and rejects a bad format", async () => {
    let n = 0;
    const ok = async () => (n++, '{"cutFrameId":"5:5","format":"binder","cardCells":[4]}');
    await expect(cutLinkInFigma({ claude: ok, fetch, fileKey: "K" }, "1:2")).resolves.toEqual({ cutFrameId: "5:5", format: "binder", cardCells: [4] });
    expect(n).toBe(1);
    let m = 0;
    const bad = async () => (m++, '{"cutFrameId":"5:5","format":"poster"}');
    await expect(cutLinkInFigma({ claude: bad, fetch, fileKey: "K" }, "1:2")).rejects.toThrow();
    expect(m).toBe(1);
  });

  describe("judge", () => {
    const vote = (o: object) => async () => JSON.stringify(o);
    const seq = (...fns: (() => Promise<string>)[]) => async () => fns.shift()!();
    const bad = async () => {
      throw new Error("claude exited 1");
    };

    it("clean: fails on a 2-of-3 invented majority and merges problems", async () => {
      const claude = seq(
        vote({ invented: true, color: true, problems: ["rain", "night"] }),
        vote({ invented: true, color: false, problems: ["rain", "x".repeat(300)] }),
        vote({ invented: false, color: false, problems: [] }),
      );
      const v = await judge("clean", ["/w/a.png"], "/w", claude as any);
      expect(v.fail).toBe(true);
      expect(v.flags).toEqual(["invented"]);
      expect(v.problems).toEqual(["rain", "night", "x".repeat(200)]);
    });

    it("clean: a single vote is not a majority; color alone does not fail", async () => {
      const claude = seq(vote({ invented: true, color: true }), vote({ color: true }), vote({}));
      const v = await judge("clean", ["/w/a.png"], "/w", claude as any);
      expect(v).toMatchObject({ fail: false, flags: ["color"] });
    });

    it("final: only scale gates; unparseable and throwing votes count as no flags", async () => {
      const claude = seq(vote({ seam: true, scale: true }), async () => "no json", vote({ seam: true, scale: true }));
      const v = await judge("final", ["/w/f.png", "/w/c1.png"], "/w", claude as any);
      expect(v).toMatchObject({ fail: true, flags: ["seam", "scale"] });
      const seamOnly = await judge("final", ["/w/f.png"], "/w", seq(vote({ seam: true }), vote({ seam: true }), bad) as any);
      expect(seamOnly).toMatchObject({ fail: false, flags: ["seam"] });
    });

    it("all votes failing is skipped, a pass", async () => {
      const v = await judge("final", ["/w/f.png"], "/w", bad as any);
      expect(v).toMatchObject({ fail: false, flags: [], skipped: "claude exited 1" });
    });

    it("asks sonnet with Read in the work dir, naming the files", async () => {
      const seen: any[] = [];
      const claude = async (p: string, t: number, _s: undefined, o: any) => (seen.push({ p, t, o }), "{}");
      await judge("final", ["/w/f.png", "/w/c1.png", "/w/c2.png"], "/w", claude as any);
      expect(seen).toHaveLength(3);
      expect(seen[0].o).toEqual({ model: "sonnet", tools: "Read", cwd: "/w" });
      expect(seen[0].t).toBe(120_000);
      expect(seen[0].p).toContain("Read ./f.png (full print insert) and ./c1.png ./c2.png (zoom");
    });
  });

  it("runClaude keeps haiku and the Figma tools by default", async () => {
    const calls: any[] = [];
    const spawn = ((c: string, a: string[], o: any) => {
      calls.push({ a, o });
      const ch: any = new EventEmitter();
      ch.stdout = new EventEmitter();
      ch.stderr = new EventEmitter();
      setImmediate(() => {
        ch.stdout.emit("data", JSON.stringify({ result: "ok" }));
        ch.emit("close", 0);
      });
      return ch;
    }) as any;
    await runClaude("p", 1000, spawn);
    await runClaude("p", 1000, spawn, { model: "sonnet", tools: "Read", cwd: "/w" });
    expect(calls[0].a.slice(2, 6)).toEqual(["--model", "haiku", "--allowedTools", expect.stringContaining("use_figma")]);
    expect(calls[0].o.cwd).toBeUndefined();
    expect(calls[1].a.slice(2, 6)).toEqual(["--model", "sonnet", "--allowedTools", "Read"]);
    expect(calls[1].o.cwd).toBe("/w");
  });
});
