import { NextResponse } from "next/server";
import { validateRun, type RunInput } from "@/lib/pipeline";
import { defaultEngines, isBusy, startRun } from "@/lib/runs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  let input: RunInput;
  try {
    const cards = await Promise.all(
      form.getAll("cards").map(async (f) => {
        if (typeof f === "string") throw new Error("cards must be files");
        return { name: f.name, type: f.type, buf: Buffer.from(await f.arrayBuffer()) };
      }),
    );
    input = {
      cards,
      cells: JSON.parse(String(form.get("cells") ?? "[]")),
      formats: JSON.parse(String(form.get("formats") ?? "[]")),
      name: String(form.get("name") ?? ""),
      fileKey: process.env.FIGMA_FILE_KEY,
    };
  } catch {
    return NextResponse.json({ errors: ["Bad request."] }, { status: 400 });
  }
  const errors = validateRun(input);
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  if (isBusy()) return NextResponse.json({ errors: ["A run is already active."] }, { status: 409 });
  const id = startRun(input, defaultEngines(process.env.FIGMA_FILE_KEY!));
  return NextResponse.json({ id }, { status: 202 });
}
