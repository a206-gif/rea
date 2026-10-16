import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./files";

describe("Windows download filename sanitation", () => {
  it("removes path separators and forbidden characters", () => {
    expect(sanitizeFilename('../bad:<name>\\result?.mp4')).toBe(".._bad__name__result_.mp4");
  });

  it("protects Windows device names", () => {
    expect(sanitizeFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFilename("lpt1.png")).toBe("_lpt1.png");
  });

  it("uses a fallback for blank input", () => {
    expect(sanitizeFilename("   ... ")).toBe("orbitdesk-download");
  });
});
