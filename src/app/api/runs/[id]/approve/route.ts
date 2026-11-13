import { NextResponse } from "next/server";
import { approveFormat } from "@/lib/approve";
import { cutFrameSize } from "@/lib/cut";
import { exportNode } from "@/lib/engines/figma";
import { defaultFigmaDeps } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "";
  const r = await approveFormat(process.cwd(), id, format, (k, nid, f) => exportNode(defaultFigmaDeps(k), nid, cutFrameSize(f).w, cutFrameSize(f).h));
  const { status, ...body } = r;
  return NextResponse.json(body, { status });
}
