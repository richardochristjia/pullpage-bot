import { spawn as nodeSpawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CANVAS, cardRect, type Format } from "../geometry";
import { jpegUnder } from "../imaging";
import type { FigmaInput } from "./types";

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

export function extractJson(text: string): any {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(s, e + 1));
}

const TOOLS = ["create_session", "use_figma", "upload_assets", "download_assets"]
  .map((t) => `mcp__plugin_figma_figma__${t}`)
  .join(",");

export function runClaude(prompt: string, timeoutMs = 180_000, spawn: typeof nodeSpawn = nodeSpawn) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--model", "haiku", "--allowedTools", TOOLS, "--output-format", "json"],
      { stdio: ["ignore", "pipe", "pipe"] },
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

export type FigmaDeps = { claude: (prompt: string) => Promise<string>; fetch: typeof fetch; fileKey: string };

// One retry when the reply has no parseable JSON.
async function askJson(deps: FigmaDeps, prompt: string) {
  for (let i = 0; ; i++) {
    try {
      return extractJson(await deps.claude(prompt));
    } catch (e) {
      if (i === 1) throw e;
    }
  }
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
  for (const [i, f] of files.entries()) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(f.buf)], { type: f.type }), f.name);
    const res = await deps.fetch(uploads[i].submitUrl, { method: "POST", body: form });
    const body: any = await res.json().catch(() => ({}));
    if (!body.success) throw new Error(`figma: upload failed: ${body.error ?? res.status}`);
  }

  const exp = await askJson(
    deps,
    `Use the Figma MCP tools. Call download_assets with fileKey "${fileKey}" and nodeId "${reply.frameId}". Reply with ONLY JSON: {"exportUrl":"..."}`,
  );
  const res = await deps.fetch(exp.exportUrl);
  if (!res.ok) throw new Error(`figma: export download failed: ${res.status}`);
  const png = Buffer.from(await res.arrayBuffer());
  const m = await sharp(png).metadata();
  const { w, h } = CANVAS[input.format];
  if (m.width !== w || m.height !== h) throw new Error(`figma: export is ${m.width}x${m.height}, expected ${w}x${h}`);
  const pngPath = path.join(input.workDir, `output_${input.name}_${input.format}.png`);
  await writeFile(pngPath, png);
  return {
    url: `https://www.figma.com/design/${fileKey}/?node-id=${String(reply.frameId).replace(":", "-")}`,
    pngPath,
  };
}
