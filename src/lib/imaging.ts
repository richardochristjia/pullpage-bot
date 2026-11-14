import sharp from "sharp";
import { CANVAS, CARD, cardRect, type Format } from "./geometry";

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export type Box = { left: number; top: number; w: number; h: number; pw: number; ph: number };

export const toCard = (buf: Buffer) =>
  sharp(buf).rotate().resize(CARD.w, CARD.h, { fit: "fill" }).png().toBuffer();

export async function padTo34(buf: Buffer, w: number, h: number) {
  const pw = w / h < 3 / 4 ? Math.round((h * 3) / 4) : w;
  const ph = w / h < 3 / 4 ? h : Math.round((w * 4) / 3);
  const left = Math.floor((pw - w) / 2);
  const top = Math.floor((ph - h) / 2);
  const out = await sharp(buf)
    .extend({ left, top, right: pw - w - left, bottom: ph - h - top, background: WHITE })
    .png()
    .toBuffer();
  return { buf: out, box: { left, top, w, h, pw, ph } as Box };
}

export async function unpadFrom34(buf: Buffer, box: Box) {
  const resized = await sharp(buf)
    .resize(box.pw, box.ph, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();
  return sharp(resized)
    .extract({ left: box.left, top: box.top, width: box.w, height: box.h })
    .png()
    .toBuffer();
}

export function composeCanvas(format: Format, items: { cell: number; png: Buffer }[]) {
  const { w, h } = CANVAS[format];
  return sharp({ create: { width: w, height: h, channels: 3, background: WHITE } })
    .composite(items.map(({ cell, png }) => {
      const { x, y } = cardRect(format, cell);
      return { input: png, left: x, top: y };
    }))
    .png()
    .toBuffer();
}

export async function jpegUnder(buf: Buffer, maxBytes = 9.5 * 1024 * 1024) {
  for (let q = 92; q >= 60; q -= 6) {
    const out = await sharp(buf).jpeg({ quality: q }).toBuffer();
    if (out.length < maxBytes) return out;
  }
  throw new Error("background too large for Figma upload");
}

const GAP = 32;
const MARGIN = 300;
const FULL_MAX = 1200;

// Original card (left) and cleaned card (right) in one PNG for the clean judge.
export async function cleanPair(orig: Buffer, clean: Buffer) {
  const fit = (b: Buffer) => sharp(b).resize(CARD.w, CARD.h, { fit: "fill" }).png().toBuffer();
  return sharp({ create: { width: CARD.w * 2 + GAP, height: CARD.h, channels: 3, background: WHITE } })
    .composite([
      { input: await fit(orig), left: 0, top: 0 },
      { input: await fit(clean), left: CARD.w + GAP, top: 0 },
    ])
    .png()
    .toBuffer();
}

// Background with the original cards placed on it: a shrunk full frame, the shrunk background alone, and one crop per card with a margin.
export async function finalPreviews(format: Format, bg: Buffer, cards: { cell: number; png: Buffer }[]) {
  const placed = await sharp(bg)
    .composite(cards.map(({ cell, png }) => ({ input: png, left: cardRect(format, cell).x, top: cardRect(format, cell).y })))
    .png()
    .toBuffer();
  const { width, height } = await sharp(placed).metadata();
  const full = await sharp(placed).resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const raw = await sharp(bg).resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const crops = await Promise.all(
    cards.map(({ cell }) => {
      const r = cardRect(format, cell);
      const left = Math.max(0, r.x - MARGIN);
      const top = Math.max(0, r.y - MARGIN);
      return sharp(placed)
        .extract({ left, top, width: Math.min(width!, r.x + r.w + MARGIN) - left, height: Math.min(height!, r.y + r.h + MARGIN) - top })
        .png()
        .toBuffer();
    }),
  );
  return { full, raw, crops };
}
