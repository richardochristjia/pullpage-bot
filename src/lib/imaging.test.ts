import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composeCanvas, jpegUnder, padTo34, toCard, unpadFrom34 } from "./imaging";
import { CANVAS } from "./geometry";

const solid = (w: number, h: number, c = { r: 200, g: 30, b: 30 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

describe("imaging", () => {
  it("toCard gives 750x1050", async () => {
    const m = await sharp(await toCard(await solid(736, 1024))).metadata();
    expect([m.width, m.height]).toEqual([750, 1050]);
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
});
