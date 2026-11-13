import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { findLinkPdf } from "@/lib/links";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const found = await findLinkPdf(process.cwd(), new URL(req.url).searchParams.get("node") ?? "");
  if (!found) return new NextResponse(null, { status: 404 });
  const pdf = await readFile(found.path);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(found.file)}` },
  });
}
