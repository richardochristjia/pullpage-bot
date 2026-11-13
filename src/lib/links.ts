import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPdf, cutFrameSize, cutLayout, cutPieces, pdfFileName } from "./cut";
import { exportNode, readCutFrame, type FigmaDeps } from "./engines/figma";
import { FORMATS } from "./geometry";

export function parseFrameLink(url: string, fileKey = process.env.FIGMA_FILE_KEY) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("Not a link.");
  }
  if (u.hostname !== "figma.com" && u.hostname !== "www.figma.com") throw new Error("Not a Figma link.");
  const m = u.pathname.match(/^\/(?:design|file)\/([^/]+)(?:\/branch\/([^/]+))?/);
  const key = m && (m[2] ?? m[1]);
  if (!key) throw new Error("Not a Figma file link.");
  if (!fileKey) throw new Error("FIGMA_FILE_KEY is not set.");
  if (key !== fileKey) throw new Error("Not the configured Figma file.");
  const id = u.searchParams.get("node-id") ?? "";
  if (!/^\d+[-:]\d+$/.test(id)) throw new Error("Link has no frame node-id.");
  return { fileKey: key, nodeId: id.replace("-", ":") };
}

const dashed = (nodeId: string) => nodeId.replace(":", "-");
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function exportLink(root: string, url: string, deps: FigmaDeps) {
  const { nodeId } = parseFrameLink(url, deps.fileKey);
  const r = await readCutFrame(deps, nodeId);
  const format = FORMATS.find((f) => cutFrameSize(f).w === r.w && cutFrameSize(f).h === r.h);
  if (!format) throw new Error(`not a cut frame: ${r.w}x${r.h}`);
  const cells = [...new Set(r.cells)].sort((a, b) => a - b);
  // Binder cards leave holes in the grid; toploader always has all 9 pieces.
  const cardCells = format === "binder" ? [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !cells.includes(c)) : [];
  if (!cells.length || !same(cutLayout(format, cardCells).map((p) => p.cell), cells)) throw new Error("cut frame pieces do not match the layout");

  const png = await exportNode(deps, nodeId, r.w, r.h);
  const pieces = await cutPieces(png, format, cardCells);
  const pdf = await buildPdf(pieces, format);

  const node = dashed(nodeId);
  const dir = path.join(root, "output", "links", node);
  const file = pdfFileName(r.name.replace(/^cut_/, ""), format);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${file}.tmp`), pdf);
  await rename(path.join(dir, `${file}.tmp`), path.join(dir, file));
  for (const f of await readdir(dir)) if (f.endsWith(".pdf") && f !== file) await unlink(path.join(dir, f));
  return { pdf: `/api/links/pdf?node=${node}`, format, pages: pieces.length };
}

export async function findLinkPdf(root: string, node: string) {
  if (!/^\d+-\d+$/.test(node)) return null;
  const dir = path.join(root, "output", "links", node);
  const f = (await readdir(dir).catch(() => [] as string[])).find((n) => n.endsWith(".pdf"));
  return f ? { file: f, path: path.join(dir, f) } : null;
}
