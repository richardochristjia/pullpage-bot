import { spawn as nodeSpawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { cutFrameSize, cutLayout } from "../cut";
import { CANVAS, CARD, FORMATS, cardRect, type Format } from "../geometry";
import { jpegUnder } from "../imaging";
import type { CleanFrameInput, FigmaInput, Verdict } from "./types";

export function buildFrameScript(o: { name: string; format: Format; cards: { cell: number; label: string }[] }) {
  const { w, h } = CANVAS[o.format];
  const cards = o.cards.map((c) => ({ label: c.label, ...cardRect(o.format, c.cell) }));
  return `let page = figma.root.children.find((p) => p.name === "Automation");
if (!page) { page = figma.createPage(); page.name = "Automation"; }
await figma.setCurrentPageAsync(page);
const right = page.children.reduce((m, n) => Math.max(m, n.x + n.width), -200) + 200;
const frame = figma.createFrame();
frame.name = ${JSON.stringify(`output_${o.name}_${o.format}`)};
frame.resize(${w}, ${h});
frame.x = right; frame.y = 0;
frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
frame.clipsContent = true;
const bg = figma.createRectangle(); bg.name = "background"; bg.resize(${w}, ${h});
frame.appendChild(bg); bg.x = 0; bg.y = 0;
const cardIds = [];
for (const c of ${JSON.stringify(cards)}) {
  const r = figma.createRectangle(); r.name = c.label; r.resize(c.w, c.h);
  frame.appendChild(r); r.x = c.x; r.y = c.y; cardIds.push(r.id);
}
return { pageId: page.id, frameId: frame.id, bgId: bg.id, cardIds };`;
}

export function buildCleanFrameScript(o: { name: string; count: number }) {
  const w = o.count * CARD.w + (o.count - 1) * 64;
  return `let page = figma.root.children.find((p) => p.name === "Automation");
if (!page) { page = figma.createPage(); page.name = "Automation"; }
await figma.setCurrentPageAsync(page);
const right = page.children.reduce((m, n) => Math.max(m, n.x + n.width), -200) + 200;
const frame = figma.createFrame();
frame.name = ${JSON.stringify(`clean_${o.name}`)};
frame.resize(${w}, ${CARD.h});
frame.x = right; frame.y = 0;
frame.fills = [];
frame.clipsContent = true;
const cleanIds = [];
for (let i = 0; i < ${o.count}; i++) {
  const r = figma.createRectangle(); r.name = "clean" + (i + 1); r.resize(${CARD.w}, ${CARD.h});
  frame.appendChild(r); r.x = i * ${CARD.w + 64}; r.y = 0; cleanIds.push(r.id);
}
return { pageId: page.id, frameId: frame.id, cleanIds };`;
}

export function extractJson(text: string): any {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(s, e + 1));
}

const TOOLS = ["create_session", "use_figma", "upload_assets", "download_assets"]
  .map((t) => `mcp__plugin_figma_figma__${t}`)
  .join(",");

export type ClaudeOpts = { model?: string; tools?: string; cwd?: string };

export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nodeSpawn = nodeSpawn, o: ClaudeOpts = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--model", o.model ?? "haiku", "--allowedTools", o.tools ?? TOOLS, "--output-format", "json"],
      { stdio: ["ignore", "pipe", "pipe"], ...(o.cwd ? { cwd: o.cwd } : {}) },
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(-500)}`));
      try {
        resolve(JSON.parse(out).result);
      } catch {
        reject(new Error("claude returned unreadable output"));
      }
    });
  });
}

const JUDGE_RULES = {
  clean: { checks: ["invented", "color", "scale", "smear"], gate: "invented" },
  final: { checks: ["seam", "scale", "smear"], gate: "scale" },
} as const;

function judgePrompt(kind: "clean" | "final", names: string[]) {
  const reply = (cs: readonly string[]) =>
    `Reply with only JSON: {${cs.map((c) => `"${c}": bool`).join(", ")}, "problems": ["..."]}.`;
  if (kind === "clean") {
    return `Read ./${names[0]}. Left: a trading card. Right: an image generated to extend ONLY the illustration in the card art window outward to fill the canvas. Look first at what the art window itself shows, then at what the right image adds outside that area. Answer each question with true or false:
invented: the added area shows scenery the art window does not (new sky, buildings, weather, night, landscape)
color: the added area clearly shifts color, brightness or lighting from the art window
scale: objects continued from the art window change size or perspective
smear: any region is smeared, melted, blurry or nonsensical
${reply(JUDGE_RULES.clean.checks)}`;
  }
  return `Read ./${names[0]} (full print insert) and ${names.slice(1).map((n) => `./${n}`).join(" ")} (zoom on each trading card and the background around it). The background was generated to extend the illustration inside the card art window outward. Answer each question with true or false:
seam: at the edges of the card, the background does not read as a continuation of the art window (colors, lighting, surfaces or lines break)
scale: objects continued from the art window are clearly a different size or perspective outside the card
smear: any background region is smeared, melted, blurry or nonsensical
${reply(JUDGE_RULES.final.checks)}`;
}

type JudgeClaude = (prompt: string, timeoutMs: number, spawn: undefined, o: ClaudeOpts) => Promise<string>;

// Three parallel votes, majority (2 of 3) per check. A vote that throws or can't be parsed counts as nothing.
export async function judge(
  kind: "clean" | "final",
  paths: string[],
  cwd: string,
  claude: JudgeClaude = runClaude,
): Promise<Verdict> {
  const { checks, gate } = JUDGE_RULES[kind];
  const prompt = judgePrompt(kind, paths.map((p) => path.basename(p)));
  const votes = await Promise.allSettled(
    [0, 1, 2].map(async () => extractJson(await claude(prompt, 120_000, undefined, { model: "sonnet", tools: "Read", cwd }))),
  );
  const ok = votes.flatMap((v) => (v.status === "fulfilled" && v.value ? [v.value] : []));
  if (!ok.length) {
    const last = [...votes].reverse().find((v) => v.status === "rejected") as PromiseRejectedResult | undefined;
    return { fail: false, flags: [], problems: [], skipped: String(last?.reason?.message ?? last?.reason ?? "no verdict") };
  }
  const flags = checks.filter((c) => ok.filter((v) => v[c] === true).length >= 2);
  const problems = [
    ...new Set(
      ok.flatMap((v) => (Array.isArray(v.problems) ? v.problems : []))
        .filter((p): p is string => typeof p === "string" && !!p.trim())
        .map((p) => p.trim().slice(0, 200)),
    ),
  ].slice(0, 5);
  return { fail: flags.includes(gate), flags, problems };
}

export type FigmaDeps = { claude: (prompt: string) => Promise<string>; fetch: typeof fetch; fileKey: string };

// Retry only idempotent prompts: re-running the frame-creating one leaves a duplicate frame.
async function askJson(deps: FigmaDeps, prompt: string, tries: number) {
  for (let i = 1; ; i++) {
    try {
      return extractJson(await deps.claude(prompt));
    } catch (e) {
      if (i >= tries) throw e;
    }
  }
}

export async function exportNode(deps: FigmaDeps, nodeId: string, w: number, h: number): Promise<Buffer> {
  const exp = await askJson(
    deps,
    `Use the Figma MCP tools. Call download_assets with fileKey "${deps.fileKey}" and nodeId "${nodeId}". Reply with ONLY JSON: {"exportUrl":"..."}`,
    2,
  );
  const res = await deps.fetch(exp.exportUrl);
  if (!res.ok) throw new Error(`figma: export download failed: ${res.status}`);
  const png = Buffer.from(await res.arrayBuffer());
  const m = await sharp(png).metadata();
  if (m.width !== w || m.height !== h) throw new Error(`figma: export is ${m.width}x${m.height}, expected ${w}x${h}`);
  return png;
}

export const exportFrame = (deps: FigmaDeps, frameId: string, format: Format) =>
  exportNode(deps, frameId, CANVAS[format].w, CANVAS[format].h);

export function buildCutScript(o: { frameId: string; oldCutFrameId?: string; name: string; format: Format; pieces: ReturnType<typeof cutLayout>; size: { w: number; h: number } }) {
  const pieces = o.pieces.map((p) => ({ cell: p.cell, sx: p.src.x, sy: p.src.y, dx: p.dst.x, dy: p.dst.y, w: p.w, h: p.h }));
  return `const src = await figma.getNodeByIdAsync(${JSON.stringify(o.frameId)});
if (!src) throw new Error("frame not found");
let pg = src; while (pg.type !== "PAGE") pg = pg.parent;
await figma.setCurrentPageAsync(pg);
${o.oldCutFrameId ? `const old = await figma.getNodeByIdAsync(${JSON.stringify(o.oldCutFrameId)});
if (old) old.remove();` : ""}
const cut = figma.createFrame();
cut.name = ${JSON.stringify(`cut_${o.name}_${o.format}`)};
cut.resize(${o.size.w}, ${o.size.h});
cut.x = src.x + src.width + 200; cut.y = src.y;
cut.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
cut.clipsContent = true;
for (const q of ${JSON.stringify(pieces)}) {
  const p = figma.createFrame(); p.name = "piece " + (q.cell + 1);
  p.resize(q.w, q.h); p.clipsContent = true; p.fills = [];
  cut.appendChild(p); p.x = q.dx; p.y = q.dy;
  const c = src.clone(); p.appendChild(c);
  c.x = -q.sx; c.y = -q.sy;
  for (const n of [...c.children]) if (/^card\\d+$/.test(n.name)) n.remove();
}
return { cutFrameId: cut.id };`;
}

export function buildLinkCutScript(o: { nodeId: string }) {
  const L = Object.fromEntries(
    FORMATS.map((f) => [
      f,
      {
        w: CANVAS[f].w,
        h: CANVAS[f].h,
        size: cutFrameSize(f),
        rects: Array.from({ length: 9 }, (_, c) => cardRect(f, c)),
        pieces: cutLayout(f, []).map((p) => ({ cell: p.cell, sx: p.src.x, sy: p.src.y, dx: p.dst.x, dy: p.dst.y, w: p.w, h: p.h })),
      },
    ]),
  );
  return `const L = ${JSON.stringify(L)};
const src = await figma.getNodeByIdAsync(${JSON.stringify(o.nodeId)});
if (!src || src.type !== "FRAME") throw new Error("frame not found");
if (!src.parent || src.parent.type !== "PAGE") throw new Error("frame must sit directly on a page");
await figma.setCurrentPageAsync(src.parent);
const W = Math.round(src.width), H = Math.round(src.height);
const fmt = Object.keys(L).find((k) => L[k].w === W && L[k].h === H);
if (!fmt) throw new Error("frame is " + W + "x" + H + ", not binder or toploader");
const cardCells = [];
for (const n of src.children) {
  if (!/^card\\d+$/.test(n.name)) continue;
  const i = L[fmt].rects.findIndex((r) => Math.abs(r.x - n.x) <= 2 && Math.abs(r.y - n.y) <= 2);
  if (i >= 0 && !cardCells.includes(i)) cardCells.push(i);
}
const cutName = "cut_" + src.name;
for (const n of [...src.parent.children]) if (n.type === "FRAME" && n.name === cutName) n.remove();
const cut = figma.createFrame();
cut.name = cutName;
cut.resize(L[fmt].size.w, L[fmt].size.h);
cut.x = src.x + src.width + 200; cut.y = src.y;
cut.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
cut.clipsContent = true;
for (const q of L[fmt].pieces) {
  if (fmt === "binder" && cardCells.includes(q.cell)) continue;
  const p = figma.createFrame(); p.name = "piece " + (q.cell + 1);
  p.resize(q.w, q.h); p.clipsContent = true; p.fills = [];
  cut.appendChild(p); p.x = q.dx; p.y = q.dy;
  const c = src.clone(); p.appendChild(c);
  c.x = -q.sx; c.y = -q.sy;
  for (const n of [...c.children]) if (/^card\\d+$/.test(n.name)) n.remove();
}
return { cutFrameId: cut.id, format: fmt, cardCells };`;
}

export async function cutLinkInFigma(deps: FigmaDeps, nodeId: string) {
  const reply = await askJson(
    deps,
    `Use the Figma MCP tools. 1) Call create_session with fileKey "${deps.fileKey}". 2) Call use_figma with fileKey "${deps.fileKey}" and this code verbatim:\n${buildLinkCutScript({ nodeId })}\nReply with ONLY JSON: {"cutFrameId":"...","format":"...","cardCells":[...]}`,
    1,
  );
  if (!reply.cutFrameId || !FORMATS.includes(reply.format)) throw new Error("figma: unexpected cut reply");
  return { cutFrameId: String(reply.cutFrameId), format: reply.format as Format, cardCells: (reply.cardCells ?? []) as number[] };
}

export const buildReadCutScript = (o: { nodeId: string }) => `const n = await figma.getNodeByIdAsync(${JSON.stringify(o.nodeId)});
if (!n) throw new Error("frame not found");
return { w: Math.round(n.width), h: Math.round(n.height), name: n.name, cells: (n.children ?? []).filter((c) => /^piece \\d+$/.test(c.name)).map((c) => Number(c.name.slice(6)) - 1) };`;

export async function readCutFrame(deps: FigmaDeps, nodeId: string) {
  const r = await askJson(
    deps,
    `Use the Figma MCP tools. 1) Call create_session with fileKey "${deps.fileKey}". 2) Call use_figma with fileKey "${deps.fileKey}" and this code verbatim:\n${buildReadCutScript({ nodeId })}\nReply with ONLY JSON: {"w":...,"h":...,"name":"...","cells":[...]}`,
    2,
  );
  if (!Number.isFinite(r.w) || !Number.isFinite(r.h) || typeof r.name !== "string" || !Array.isArray(r.cells)) throw new Error("figma: unexpected read reply");
  return r as { w: number; h: number; name: string; cells: number[] };
}

export async function cutToFigma(deps: FigmaDeps, frameId: string, format: Format, cardCells: number[], name: string, oldCutFrameId?: string): Promise<string> {
  const script = buildCutScript({ frameId, oldCutFrameId, name, format, pieces: cutLayout(format, cardCells), size: cutFrameSize(format) });
  const reply = await askJson(
    deps,
    `Use the Figma MCP tools. 1) Call create_session with fileKey "${deps.fileKey}". 2) Call use_figma with fileKey "${deps.fileKey}" and this code verbatim:\n${script}\nReply with ONLY JSON: {"cutFrameId":"..."}`,
    1,
  );
  if (!reply.cutFrameId) throw new Error("figma: no cutFrameId");
  return String(reply.cutFrameId);
}

async function postFiles(deps: FigmaDeps, uploads: { submitUrl: string }[], files: { name: string; type: string; buf: Buffer }[]) {
  for (const [i, f] of files.entries()) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(f.buf)], { type: f.type }), f.name);
    const res = await deps.fetch(uploads[i].submitUrl, { method: "POST", body: form });
    const body: any = await res.json().catch(() => ({}));
    if (!body.success) throw new Error(`figma: upload failed: ${body.error ?? res.status}`);
  }
}

export async function publishCleanFrame(input: CleanFrameInput, deps: FigmaDeps) {
  const { fileKey } = deps;
  const count = input.cleaned.length;
  const script = buildCleanFrameScript({ name: input.name, count });
  const reply = await askJson(
    deps,
    `Use the Figma MCP tools. 1) Call create_session with fileKey "${fileKey}". 2) Call use_figma with fileKey "${fileKey}" and this code verbatim:\n${script}\n3) Call upload_assets with fileKey "${fileKey}", count ${count}, nodeIds = cleanIds from the result, and currentPageId = pageId from the result. Reply with ONLY JSON: {"frameId":"...","uploads":[{"nodeId":"...","submitUrl":"..."}]} in the same order as nodeIds.`,
    1,
  );
  const uploads: { nodeId: string; submitUrl: string }[] = reply.uploads;
  if (!Array.isArray(uploads) || uploads.length !== count || !reply.frameId) throw new Error("figma: unexpected upload list");
  if (new Set(uploads.map((u) => u.nodeId)).size !== count) throw new Error("figma: node IDs mismatch");
  await postFiles(deps, uploads, input.cleaned.map((buf, k) => ({ name: `clean${k + 1}.png`, type: "image/png", buf })));
  return { frameId: String(reply.frameId) };
}

export async function publishToFigma(input: FigmaInput, deps: FigmaDeps) {
  const { fileKey } = deps;
  const script = buildFrameScript({
    name: input.name,
    format: input.format,
    cards: input.originals,
  });
  const reply = await askJson(
    deps,
    `Use the Figma MCP tools. 1) Call create_session with fileKey "${fileKey}". 2) Call use_figma with fileKey "${fileKey}" and this code verbatim:\n${script}\n3) Call upload_assets with fileKey "${fileKey}", count ${1 + input.originals.length}, nodeIds = [bgId, ...cardIds] from the result, and currentPageId = pageId from the result. Reply with ONLY JSON: {"pageId":"...","frameId":"...","uploads":[{"nodeId":"...","submitUrl":"..."}]} in the same order as nodeIds.`,
    1,
  );
  const uploads: { nodeId: string; submitUrl: string }[] = reply.uploads;
  if (!Array.isArray(uploads) || uploads.length !== 1 + input.originals.length || !reply.frameId) {
    throw new Error("figma: unexpected upload list");
  }
  const ids = uploads.map((u) => u.nodeId);
  if (new Set(ids).size !== ids.length) throw new Error("figma: node IDs mismatch");

  // First is the background, then cards in order; post at once, URLs are single-use.
  const files = [
    { name: "background.jpg", type: "image/jpeg", buf: await jpegUnder(input.bg) },
    ...input.originals.map((o) => ({ name: `${o.label}.png`, type: "image/png", buf: o.png })),
  ];
  await postFiles(deps, uploads, files);

  const png = await exportFrame(deps, String(reply.frameId), input.format);
  const pngPath = path.join(input.workDir, `output_${input.name}_${input.format}.png`);
  await writeFile(pngPath, png);
  return {
    url: `https://www.figma.com/design/${fileKey}/?node-id=${String(reply.frameId).replace(":", "-")}`,
    pngPath,
    frameId: String(reply.frameId),
  };
}
