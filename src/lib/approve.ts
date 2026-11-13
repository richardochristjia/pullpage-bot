import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPdf, cutPieces, pdfFileName } from "./cut";
import { FORMATS, type Format } from "./geometry";

export type RunMeta = {
  id: string;
  name: string;
  slug: string;
  cells: number[];
  fileKey?: string;
  cleanFrameId?: string;
  createdAt: string;
  formats: Partial<Record<Format, { frameId: string; cutFrameId?: string; approvedAt?: string }>>;
};
export type Exporter = (fileKey: string, frameId: string, format: Format) => Promise<Buffer>;
export type Cutter = (fileKey: string, frameId: string, format: Format, cells: number[], name: string, oldCutFrameId?: string) => Promise<string>;
export type CutResult = { status: 200; figmaUrl: string } | { status: 404 | 409 | 500; error: string };
export type ApproveResult = { status: 200; pdf: string } | { status: 404 | 409 | 500; error: string };

export const isRunId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isFormat = (s: string): s is Format => FORMATS.includes(s as Format);

export async function readMeta(root: string, id: string): Promise<RunMeta | null> {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(root, "output", id, "run.json"), "utf8"));
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __approving?: Set<string> };
const locks = (g.__approving ??= new Set());

export async function cutFormat(root: string, id: string, format: string, cutter: Cutter): Promise<CutResult> {
  const meta = isFormat(format) ? await readMeta(root, id) : null;
  const entry = meta?.formats[format as Format];
  if (!meta || !entry) return { status: 404, error: "Run not found." };
  const f = format as Format;
  const key = id; // per run: both formats rewrite the same run.json
  if (locks.has(key)) return { status: 409, error: "Busy." };
  locks.add(key);
  try {
    if (!meta.fileKey) throw new Error("run.json has no fileKey");
    entry.cutFrameId = await cutter(meta.fileKey, entry.frameId, f, meta.cells, meta.slug, entry.cutFrameId);
    delete entry.approvedAt; // a new cut makes the old PDF stale
    await writeFile(path.join(root, "output", id, "run.json"), JSON.stringify(meta, null, 2));
    return { status: 200, figmaUrl: `https://www.figma.com/design/${meta.fileKey}/?node-id=${entry.cutFrameId.replace(":", "-")}` };
  } catch (e) {
    return { status: 500, error: e instanceof Error ? e.message : String(e) };
  } finally {
    locks.delete(key);
  }
}

export async function approveFormat(root: string, id: string, format: string, exporter: Exporter): Promise<ApproveResult> {
  const meta = isFormat(format) ? await readMeta(root, id) : null;
  const entry = meta?.formats[format as Format];
  if (!meta || !entry) return { status: 404, error: "Run not found." };
  const f = format as Format;
  if (!entry.cutFrameId) return { status: 409, error: "Cut to Figma first." };
  const key = id; // per run: both formats rewrite the same run.json
  if (locks.has(key)) return { status: 409, error: "Busy." };
  locks.add(key);
  try {
    if (!meta.fileKey) throw new Error("run.json has no fileKey");
    const png = await exporter(meta.fileKey, entry.cutFrameId, f);
    const pdf = await buildPdf(await cutPieces(png, f, meta.cells), f);
    const dir = path.join(root, "output", id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `output_${meta.slug}_${f}.approved.png`), png);
    const final = path.join(dir, pdfFileName(meta.name, f));
    await writeFile(`${final}.tmp`, pdf);
    await rename(`${final}.tmp`, final);
    entry.approvedAt = new Date().toISOString();
    await writeFile(path.join(dir, "run.json"), JSON.stringify(meta, null, 2));
    return { status: 200, pdf: `/api/runs/${id}/pdf?format=${f}` };
  } catch (e) {
    return { status: 500, error: e instanceof Error ? e.message : String(e) };
  } finally {
    locks.delete(key);
  }
}

export async function listRuns(root: string) {
  const ids = await readdir(path.join(root, "output")).catch(() => [] as string[]);
  const runs = [];
  for (const id of ids) {
    const meta = await readMeta(root, id);
    if (!meta) continue;
    const formats = [];
    for (const format of Object.keys(meta.formats) as Format[]) {
      const approved = !!meta.formats[format]?.approvedAt && await stat(path.join(root, "output", id, pdfFileName(meta.name, format))).then(() => true, () => false);
      formats.push({ format, cut: !!meta.formats[format]?.cutFrameId, approved });
    }
    runs.push({ id, name: meta.name, createdAt: meta.createdAt, formats });
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
