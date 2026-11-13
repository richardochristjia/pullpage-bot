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
  createdAt: string;
  formats: Partial<Record<Format, { frameId: string; approvedAt?: string }>>;
};
export type Exporter = (fileKey: string, frameId: string, format: Format) => Promise<Buffer>;
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

export async function approveFormat(root: string, id: string, format: string, exporter: Exporter): Promise<ApproveResult> {
  const meta = isFormat(format) ? await readMeta(root, id) : null;
  const entry = meta?.formats[format as Format];
  if (!meta || !entry) return { status: 404, error: "Run not found." };
  const f = format as Format;
  const key = `${id}:${f}`;
  if (locks.has(key)) return { status: 409, error: "Already approving." };
  locks.add(key);
  try {
    if (!meta.fileKey) throw new Error("run.json has no fileKey");
    const png = await exporter(meta.fileKey, entry.frameId, f);
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
      const approved = await stat(path.join(root, "output", id, pdfFileName(meta.name, format))).then(() => true, () => false);
      formats.push({ format, approved });
    }
    runs.push({ id, name: meta.name, createdAt: meta.createdAt, formats });
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
