import { describe, expect, it } from "vitest";
import { addAt, moveTo, nudge, removeAt } from "./placement";

describe("placement", () => {
  it("fills defaults 4, 5, 3 and refuses a 4th", () => {
    let c: number[] = [];
    for (let k = 0; k < 3; k++) c = addAt(c)!;
    expect(c).toEqual([4, 5, 3]);
    expect(addAt(c)).toBeNull();
  });
  it("drop on a free cell takes it; on a taken cell moves the occupant", () => {
    expect(addAt([4], 0)).toEqual([4, 0]);
    const c = addAt([4], 4)!;
    expect(c[1]).toBe(4);
    expect(c[0]).not.toBe(4);
  });
  it("moveTo swaps or sets", () => {
    expect(moveTo([4, 5], 0, 5)).toEqual([5, 4]);
    expect(moveTo([4, 5], 0, 0)).toEqual([0, 5]);
  });
  it("nudge stays at edges", () => {
    expect(nudge([0], 0, "up")).toEqual([0]);
    expect(nudge([0], 0, "left")).toEqual([0]);
    expect(nudge([8], 0, "right")).toEqual([8]);
    expect(nudge([4], 0, "down")).toEqual([7]);
  });
  it("removeAt keeps the others", () => {
    expect(removeAt([4, 5, 3], 1)).toEqual([4, 3]);
  });
  it("cells stay unique under random ops", () => {
    let c: number[] = [];
    const dirs = ["up", "down", "left", "right"] as const;
    for (let n = 0; n < 2000; n++) {
      const r = Math.random();
      if (r < 0.3) c = addAt(c, Math.floor(Math.random() * 9)) ?? c;
      else if (r < 0.5 && c.length) c = removeAt(c, Math.floor(Math.random() * c.length));
      else if (r < 0.75 && c.length) c = moveTo(c, Math.floor(Math.random() * c.length), Math.floor(Math.random() * 9));
      else if (c.length) c = nudge(c, Math.floor(Math.random() * c.length), dirs[Math.floor(Math.random() * 4)]);
      expect(new Set(c).size).toBe(c.length);
      expect(c.length).toBeLessThanOrEqual(3);
    }
  });
});
