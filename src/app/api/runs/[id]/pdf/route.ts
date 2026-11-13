import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isFormat, isRunId, readMeta } from "@/lib/approve";
import { pdfFileName } from "@/lib/cut";
import type { Format } from "@/lib/geometry";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "";
  const meta = isRunId(id) && isFormat(format) ? await readMeta(process.cwd(), id) : null;
  if (!meta) return new NextResponse(null, { status: 404 });
  const file = pdfFileName(meta.name, format as Format);
  try {
    const pdf = await readFile(path.join(process.cwd(), "output", id, file));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file)}` },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
