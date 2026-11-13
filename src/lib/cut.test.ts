import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildPdf, cutPieces, cutFrameSize, cutLayout, pdfFileName } from "./cut";
import { displayName } from "./pipeline";
import { type Format } from "./geometry";

const canvas = (format: Format, channels: 3 | 4 = 3, w = cutFrameSize(format).w, h = cutFrameSize(format).h) => {
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

describe("cutLayout", () => {
  it("binder skips card cells", () => {
    const r = cutLayout("binder", [4]);
    expect(r.map((x) => x.cell)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(r[0]).toMatchObject({ src: { x: 0, y: 0 }, dst: { x: 100, y: 100 }, w: 750, h: 1050 });
    expect(cutLayout("binder", [3, 4, 5])).toHaveLength(6);
  });
  it("toploader keeps all 9", () => {
    const r = cutLayout("toploader", [4]);
    expect(r).toHaveLength(9);
    expect(r[4]).toMatchObject({ src: { x: 901, y: 1201 }, dst: { x: 1064, y: 1364 }, w: 900, h: 1200 });
  });
  it("cutFrameSize", () => {
    expect(cutFrameSize("binder")).toEqual({ w: 2578, h: 3478 });
    expect(cutFrameSize("toploader")).toEqual({ w: 3028, h: 3928 });
  });
});

describe("cutPieces + buildPdf", () => {
  it("pieces are byte-equal to extract; PDF pages match pieces", async () => {
    for (const [format, cards, pw, ph, n] of [["binder", [4], 180, 252, 8], ["toploader", [4], 216, 288, 9]] as const) {
      const { raw, png } = canvas(format);
      const pieces = await cutPieces(await png, format, [...cards]);
      const rects = cutLayout(format, [...cards]);
      expect(pieces).toHaveLength(n);
      const { w } = cutFrameSize(format);
      const decoded: Buffer[] = [];
      for (const [i, p] of pieces.entries()) {
        const { data, ch } = await rawOf(p);
        const { dst: { x: left, y: top }, w: width, h: height } = rects[i];
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
    const { w, h } = cutFrameSize("binder");
    const raw = Buffer.alloc(w * h * 4); // fully transparent black
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const { data, ch } = await rawOf((await cutPieces(png, "binder", []))[0]);
    expect(ch).toBe(3);
    expect(data.every((b) => b === 255)).toBe(true);
  }, 60000);

  it("rejects a wrong-size image", async () => {
    const { png } = canvas("binder", 3, 2577, 3478);
    await expect(cutPieces(await png, "binder", [])).rejects.toThrow("cut: image is 2577x3478, expected 2578x3478");
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
