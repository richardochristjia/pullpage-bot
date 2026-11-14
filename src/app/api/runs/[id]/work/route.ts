import { readWorkFile } from "@/lib/work";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const buf = await readWorkFile(process.cwd(), (await ctx.params).id, file);
  if (!buf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
