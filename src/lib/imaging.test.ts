import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cleanPair, composeCanvas, finalPreviews, jpegUnder, padTo34, toCard, unpadFrom34 } from "./imaging";
import { CANVAS } from "./geometry";

const solid = (w: number, h: number, c = { r: 200, g: 30, b: 30 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

describe("imaging", () => {
  it("toCard gives 750x1050", async () => {
    const m = await sharp(await toCard(await solid(736, 1024))).metadata();
    expect([m.width, m.height]).toEqual([750, 1050]);
  });

  it("toCard honours EXIF orientation", async () => {
    // 1050x750 pixels, left half red, right half blue; orientation 6 turns it upright with red on top
    const raw = Buffer.alloc(1050 * 750 * 3);
    for (let y = 0; y < 750; y++) for (let x = 0; x < 1050; x++) {
      const i = (y * 1050 + x) * 3;
      raw[i] = x < 525 ? 255 : 0;
      raw[i + 2] = x < 525 ? 0 : 255;
    }
    const jpg = await sharp(raw, { raw: { width: 1050, height: 750, channels: 3 } }).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const out = await sharp(await toCard(jpg)).raw().toBuffer();
    const i = 1049 * 750 * 3; // bottom-left pixel
    expect(out[i + 2]).toBeGreaterThan(200);
  });

  it("pad then unpad keeps size and centre pixels", async () => {
    const canvas = await solid(2252, 3152);
    const { buf, box } = await padTo34(canvas, 2252, 3152);
    expect([box.pw, box.ph]).toEqual([2364, 3152]);
    const small = await sharp(buf).resize(896, 1200, { fit: "fill" }).png().toBuffer();
    const out = await unpadFrom34(small, box);
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([2252, 3152]);
    const px = await sharp(out).extract({ left: 1126, top: 1576, width: 1, height: 1 }).raw().toBuffer();
    expect(Math.abs(px[0] - 200)).toBeLessThan(4);
  });

  it("896x1200 background reaches exact canvas size", async () => {
    for (const f of ["binder", "toploader"] as const) {
      const { w, h } = CANVAS[f];
      const { buf, box } = await padTo34(await solid(w, h), w, h);
      const small = await sharp(buf).resize(896, 1200, { fit: "fill" }).png().toBuffer();
      const m = await sharp(await unpadFrom34(small, box)).metadata();
      expect([m.width, m.height]).toEqual([w, h]);
    }
  });

  it("composeCanvas has exact size and card at its cell", async () => {
    const png = await solid(750, 1050, { r: 0, g: 0, b: 255 });
    const out = await composeCanvas("toploader", [{ cell: 4, png }]);
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([2702, 3602]);
    const px = await sharp(out).extract({ left: 976, top: 1276, width: 1, height: 1 }).raw().toBuffer();
    expect([px[0], px[1], px[2]]).toEqual([0, 0, 255]);
  });

  it("jpegUnder returns under 10MB for a large noise PNG", async () => {
    const raw = Buffer.alloc(2252 * 3152 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
    const png = await sharp(raw, { raw: { width: 2252, height: 3152, channels: 3 } }).png().toBuffer();
    expect(png.length).toBeGreaterThan(10 * 1024 * 1024);
    expect((await jpegUnder(png)).length).toBeLessThan(10 * 1024 * 1024);
  }, 60000);

  it("cleanPair is two 750x1050 cards with a 32px gap", async () => {
    const m = await sharp(await cleanPair(await solid(750, 1050), await solid(896, 1200))).metadata();
    expect([m.width, m.height]).toEqual([1532, 1050]);
  });

  it("finalPreviews: full long side <= 1200, crops hold card plus 300px margin, clamped", async () => {
    const card = await solid(750, 1050);
    const size = async (b: Buffer) => { const m = await sharp(b).metadata(); return [m.width, m.height]; };
    const mid = await finalPreviews("binder", await solid(2252, 3152), [{ cell: 4, png: card }, { cell: 0, png: card }]);
    expect(await size(mid.full)).toEqual([857, 1200]);
    expect(await size(mid.raw)).toEqual([857, 1200]);
    expect((await sharp(mid.raw).stats()).channels[0].mean).toBeCloseTo(200, 0); // no card pixels
    expect(await size(mid.crops[0])).toEqual([1350, 1650]); // 750+600 x 1050+600
    expect(await size(mid.crops[1])).toEqual([1050, 1350]); // top-left card: margin clamped at 0
    const tl = await finalPreviews("toploader", await solid(2702, 3602), [{ cell: 8, png: card }]);
    expect(await size(tl.crops[0])).toEqual([1125, 1425]); // bottom-right card: clamped at the canvas edge
  });
});
