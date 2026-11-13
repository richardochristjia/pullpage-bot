import { describe, expect, it } from "vitest";
import { cardRect } from "./geometry";

describe("cardRect", () => {
  it("binder cells step 751/1051", () => {
    for (let i = 0; i < 9; i++) {
      const r = cardRect("binder", i);
      expect(r).toEqual({ x: (i % 3) * 751, y: Math.floor(i / 3) * 1051, w: 750, h: 1050 });
    }
    expect(cardRect("binder", 4)).toMatchObject({ x: 751, y: 1051 });
  });
  it("toploader card sits 75px inside its 900x1200 cell", () => {
    for (let i = 0; i < 9; i++) {
      const r = cardRect("toploader", i);
      expect(r.x).toBe((i % 3) * 901 + 75);
      expect(r.y).toBe(Math.floor(i / 3) * 1201 + 75);
    }
    expect(cardRect("toploader", 4)).toMatchObject({ x: 976, y: 1276 });
  });
});
