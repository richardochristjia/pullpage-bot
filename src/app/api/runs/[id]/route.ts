import { NextResponse } from "next/server";
import { getRun } from "@/lib/runs";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const run = getRun((await ctx.params).id);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Unknown run." }, { status: 404 });
}
