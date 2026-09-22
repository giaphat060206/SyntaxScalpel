import { describe, it, expect } from "vitest";
import { traceNeighbors } from "./trace";
import type { GraphEdge } from "../../shared/types";

const edges: GraphEdge[] = [
  { source: "main", target: "add" },
  { source: "main", target: "helper" },
  { source: "other", target: "main" },
  { source: "unrelated", target: "isolated" },
];

describe("traceNeighbors", () => {
  it("includes the node itself plus direct callees and callers", () => {
    const result = traceNeighbors(edges, "main");
    expect([...result].sort()).toEqual(["add", "helper", "main", "other"]);
  });

  it("does not include 2-hop nodes", () => {
    const result = traceNeighbors(edges, "add");
    expect([...result].sort()).toEqual(["add", "main"]);
  });

  it("returns only the node when it has no edges", () => {
    expect([...traceNeighbors(edges, "far")]).toEqual(["far"]);
  });
});
