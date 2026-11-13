import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildPdf, cutPieces, pdfFileName, pieceRects } from "./cut";
import { displayName } from "./pipeline";
import { CANVAS, type Format } from "./geometry";

const canvas = (format: Format, channels: 3 | 4 = 3, w = CANVAS[format].w, h = CANVAS[format].h) => {
  const raw = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * channels;
      raw[o] = x & 255;
      raw[o + 1] = y & 255;
      raw[o + 2] = (x >> 8) ^ (y >> 8);
      if (channels === 4) raw[o + 3] = 255;
    }
  return { raw, png: sharp(raw, { raw: { width: w, height: h, channels } }).png().toBuffer() };
};
const rawOf = async (png: Buffer) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, ch: info.channels };
};

describe("pieceRects", () => {
  it("binder skips card cells", () => {
    const r = pieceRects("binder", [4]);
    expect(r.map((x) => x.cell)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(r[0]).toMatchObject({ left: 0, top: 0, width: 750, height: 1050 });
    expect(r.at(-1)).toMatchObject({ left: 1502, top: 2102 });
    expect(r.some((x) => x.left === 751 && x.top === 1051)).toBe(false);
    expect(pieceRects("binder", [3, 4, 5])).toHaveLength(6);
    expect(pieceRects("binder", [0])[0]).toMatchObject({ left: 751, top: 0 });
  });
  it("toploader keeps all 9", () => {
    const r = pieceRects("toploader", [4]);
    expect(r).toHaveLength(9);
    expect(r.every((x) => x.width === 900 && x.height === 1200)).toBe(true);
    expect(r.some((x) => x.left === 901 && x.top === 1201)).toBe(true);
  });
});

describe("cutPieces + buildPdf", () => {
  it("pieces are byte-equal to extract; PDF pages match pieces", async () => {
    for (const [format, cards, pw, ph, n] of [["binder", [4], 180, 252, 8], ["toploader", [4], 216, 288, 9]] as const) {
      const { raw, png } = canvas(format);
      const pieces = await cutPieces(await png, format, [...cards]);
      const rects = pieceRects(format, [...cards]);
      expect(pieces).toHaveLength(n);
      const { w } = CANVAS[format];
      const decoded: Buffer[] = [];
      for (const [i, p] of pieces.entries()) {
        const { data, ch } = await rawOf(p);
        const { left, top, width, height } = rects[i];
        const ref = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y++) raw.copy(ref, y * width * 3, ((top + y) * w + left) * 3, ((top + y) * w + left + width) * 3);
        expect(ch).toBe(3);
        expect(data.equals(ref)).toBe(true);
        decoded.push(data);
      }
      const doc = await PDFDocument.load(await buildPdf(pieces, format));
      const pages = doc.getPages();
      expect(pages).toHaveLength(n);
      pages.forEach((p) => expect([p.getWidth(), p.getHeight()]).toEqual([pw, ph]));
      const imgs = doc.context
        .enumerateIndirectObjects()
        .map(([, o]) => o)
        .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
      expect(imgs).toHaveLength(n);
      imgs.forEach((o, i) => expect(Buffer.from(decodePDFRawStream(o).decode()).equals(decoded[i])).toBe(true));
    }
  }, 60000);

  it("flattens RGBA onto white", async () => {
    const { w, h } = CANVAS.binder;
    const raw = Buffer.alloc(w * h * 4); // fully transparent black
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const { data, ch } = await rawOf((await cutPieces(png, "binder", []))[0]);
    expect(ch).toBe(3);
    expect(data.every((b) => b === 255)).toBe(true);
  }, 60000);

  it("rejects a wrong-size image", async () => {
    const { png } = canvas("binder", 3, 2251, 3152);
    await expect(cutPieces(await png, "binder", [])).rejects.toThrow("cut: image is 2251x3152, expected 2252x3152");
  });
});

describe("names", () => {
  it("displayName and pdfFileName", () => {
    const i = (name: string) => ({ name, cards: [] }) as never;
    expect(displayName(i("goldeen_ar.png"))).toBe("goldeen_ar");
    expect(displayName(i("a/b:c"))).toBe("abc");
    expect(pdfFileName("Goldeen AR", "binder")).toBe("Goldeen AR binder.pdf");
  });
});
