import { NextResponse } from "next/server";
import { exportLink, handleLink } from "@/lib/links";
import { defaultFigmaDeps } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { url } = await req.json().catch(() => ({}));
  const deps = defaultFigmaDeps(process.env.FIGMA_FILE_KEY ?? "");
  const r = await handleLink(url, deps, (u) => exportLink(process.cwd(), u, deps));
  return NextResponse.json(r.body, { status: r.status });
}
