import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { Format } from "./geometry";

// Match cardRect and CANVAS: 3*750+2 = 2252, 3*900+2 = 2702.
const PIECE = {
  binder: { w: 750, h: 1050, sx: 751, sy: 1051 },
  toploader: { w: 900, h: 1200, sx: 901, sy: 1201 },
};

export const PAD = 100;
export const GAP = 64;

export function cutFrameSize(format: Format) {
  const { w, h } = PIECE[format];
  return { w: 2 * PAD + 3 * w + 2 * GAP, h: 2 * PAD + 3 * h + 2 * GAP };
}

// src = the cell's origin in the run frame, dst = its spot in the cut frame.
export function cutLayout(format: Format, cardCells: number[]) {
  const { w, h, sx, sy } = PIECE[format];
  const out = [];
  for (let cell = 0; cell < 9; cell++) {
    if (format === "binder" && cardCells.includes(cell)) continue;
    const col = cell % 3;
    const row = Math.floor(cell / 3);
    out.push({
      cell,
      src: { x: col * sx, y: row * sy },
      dst: { x: PAD + col * (w + GAP), y: PAD + row * (h + GAP) },
      w,
      h,
    });
  }
  return out;
}

export async function cutPieces(png: Buffer, format: Format, cardCells: number[]): Promise<Buffer[]> {
  const m = await sharp(png).metadata();
  const { w, h } = cutFrameSize(format);
  if (m.width !== w || m.height !== h) throw new Error(`cut: image is ${m.width}x${m.height}, expected ${w}x${h}`);
  // extract only: no resize, so pixels are copied as-is. Alpha is flattened on white; opaque RGB is untouched.
  return Promise.all(
    cutLayout(format, cardCells).map((p) => {
      let s = sharp(png).extract({ left: p.dst.x, top: p.dst.y, width: p.w, height: p.h });
      if (m.hasAlpha) s = s.flatten({ background: "#ffffff" });
      return s.removeAlpha().png().toBuffer();
    }),
  );
}

export async function buildPdf(pieces: Buffer[], format: Format): Promise<Uint8Array> {
  const { w, h } = PIECE[format];
  const doc = await PDFDocument.create();
  for (const p of pieces) {
    const img = await doc.embedPng(p);
    const page = doc.addPage([(w * 72) / 300, (h * 72) / 300]);
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return doc.save();
}

export const pdfFileName = (name: string, format: Format) =>
  `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim()} ${format}.pdf`;
