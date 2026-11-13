import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isFormat, isRunId, readMeta } from "@/lib/approve";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "";
  if (!isRunId(id) || !(await readMeta(process.cwd(), id)) || !isFormat(format)) return new NextResponse(null, { status: 404 });
  try {
    const dir = path.join(process.cwd(), "output", id);
    const file = (await readdir(dir)).find((f) => f.endsWith(`_${format}.png`));
    if (!file) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(await readFile(path.join(dir, file))), {
      headers: { "content-type": "image/png", "content-disposition": `inline; filename="${file}"` },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
