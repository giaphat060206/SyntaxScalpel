import { describe, it, expect } from "vitest";
import { sectionToPath } from "./path";

describe("sectionToPath", () => {
  it("returns an empty path for too few points", () => {
    expect(sectionToPath([])).toBe("");
    expect(sectionToPath([{ x: 1, y: 2 }])).toBe("");
  });

  it("draws a straight two-point section", () => {
    expect(sectionToPath([{ x: 10, y: 20 }, { x: 10, y: 90 }])).toBe(
      "M 10 20 L 10 90"
    );
  });

  it("draws an L-shaped section through its bend", () => {
    expect(
      sectionToPath([
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 80, y: 40 },
      ])
    ).toBe("M 0 0 L 0 40 L 80 40");
  });

  it("draws every bend", () => {
    const path = sectionToPath([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(path).toBe("M 0 0 L 0 10 L 10 10 L 10 20");
  });
});
