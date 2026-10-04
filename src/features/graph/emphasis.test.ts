import { describe, it, expect, vi } from "vitest";
import { emphasisVisibility, isEmphasisedEdge, isEmphasisedNode } from "./emphasis";

const pair = { ids: ["a", "b"] };

describe("emphasis", () => {
  it("holds the pair, in either order", () => {
    expect(isEmphasisedEdge({ source: "a", target: "b" }, pair)).toBe(true);
    expect(isEmphasisedEdge({ source: "b", target: "a" }, pair)).toBe(true);
  });

  it("leaves an edge that only touches one end alone", () => {
    expect(isEmphasisedEdge({ source: "a", target: "c" }, pair)).toBe(false);
    expect(isEmphasisedEdge({ source: "c", target: "b" }, pair)).toBe(false);
  });

  it("emphasises nothing without both ends", () => {
    expect(isEmphasisedEdge({ source: "a", target: "b" }, null)).toBe(false);
    expect(isEmphasisedEdge({ source: "a", target: "b" }, { ids: ["a"] })).toBe(false);
  });

  it("knows which nodes are in focus", () => {
    expect(isEmphasisedNode("a", pair)).toBe(true);
    expect(isEmphasisedNode("c", pair)).toBe(false);
    expect(isEmphasisedNode("a", null)).toBe(false);
  });

  it("keeps the pair bright, dims the rest, and defers when nothing is emphasised", () => {
    const withoutEmphasis = vi.fn(() => "dim" as const);

    expect(emphasisVisibility({ source: "a", target: "b" }, pair, withoutEmphasis)).toBe("active");
    expect(emphasisVisibility({ source: "a", target: "c" }, pair, withoutEmphasis)).toBe("dim");
    expect(emphasisVisibility({ source: "a", target: "c" }, null, withoutEmphasis)).toBe("dim");
    expect(withoutEmphasis).toHaveBeenCalledTimes(1);
  });
});
