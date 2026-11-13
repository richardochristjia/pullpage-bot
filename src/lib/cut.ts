import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { CANVAS, type Format } from "./geometry";

// Match cardRect and CANVAS: 3*750+2 = 2252, 3*900+2 = 2702.
const PIECE = {
  binder: { w: 750, h: 1050, sx: 751, sy: 1051 },
  toploader: { w: 900, h: 1200, sx: 901, sy: 1201 },
};

export function pieceRects(format: Format, cardCells: number[]) {
  const { w, h, sx, sy } = PIECE[format];
  const rects = [];
  for (let cell = 0; cell < 9; cell++) {
    if (format === "binder" && cardCells.includes(cell)) continue;
    rects.push({ cell, left: (cell % 3) * sx, top: Math.floor(cell / 3) * sy, width: w, height: h });
  }
  return rects;
}

export async function cutPieces(png: Buffer, format: Format, cardCells: number[]): Promise<Buffer[]> {
  const m = await sharp(png).metadata();
  const { w, h } = CANVAS[format];
  if (m.width !== w || m.height !== h) throw new Error(`cut: image is ${m.width}x${m.height}, expected ${w}x${h}`);
  // extract only: no resize, so pixels are copied as-is. Alpha is flattened on white; opaque RGB is untouched.
  return Promise.all(
    pieceRects(format, cardCells).map(({ cell: _c, ...rect }) => {
      let s = sharp(png).extract(rect);
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
