import { NextResponse } from "next/server";
import { cutFormat } from "@/lib/approve";
import { cutToFigma } from "@/lib/engines/figma";
import { defaultFigmaDeps } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "";
  const r = await cutFormat(process.cwd(), id, format, (k, fid, f, cells, name, old) =>
    cutToFigma(defaultFigmaDeps(k), fid, f, cells, name, old),
  );
  const { status, ...body } = r;
  return NextResponse.json(body, { status });
}
