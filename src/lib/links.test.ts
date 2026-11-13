import { describe, expect, it } from "vitest";
import { parseFrameLink } from "./links";

const base = "https://www.figma.com/design/KEY/Name";

describe("parseFrameLink", () => {
  it("accepts design, file and branch links", () => {
    expect(parseFrameLink(`${base}?node-id=12-3`, "KEY")).toEqual({ fileKey: "KEY", nodeId: "12:3" });
    expect(parseFrameLink(" https://figma.com/file/KEY/x?node-id=12%3A3 ", "KEY").nodeId).toBe("12:3");
    expect(parseFrameLink("https://www.figma.com/design/OLD/branch/KEY/x?node-id=1-2", "KEY").fileKey).toBe("KEY");
  });

  it("rejects foreign key, missing node-id, other host, garbage", () => {
    expect(() => parseFrameLink(`${base}?node-id=1-2`, "OTHER")).toThrow("Not the configured Figma file.");
    expect(() => parseFrameLink(base, "KEY")).toThrow("Link has no frame node-id.");
    expect(() => parseFrameLink("https://example.com/design/KEY/x?node-id=1-2", "KEY")).toThrow("Not a Figma link.");
    expect(() => parseFrameLink("nope", "KEY")).toThrow("Not a link.");
    expect(() => parseFrameLink(`${base}?node-id=1-2`, "")).toThrow("FIGMA_FILE_KEY is not set.");
  });
});
