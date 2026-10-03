import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { buildElkGraph } from "./graph";

function node(
  id: string,
  extra: Partial<Node> = {}
): Node {
  return {
    id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    data: {},
    ...extra,
  };
}

describe("buildElkGraph", () => {
  it("nests children under their parent", () => {
    const nodes = [
      node("folder", { style: { width: 240 } }),
      node("folder/a.ts", { parentId: "folder", measured: { width: 180, height: 60 } }),
      node("folder/b.ts", { parentId: "folder", measured: { width: 180, height: 60 } }),
    ];
    const graph = buildElkGraph(nodes, []);
    expect(graph.children).toHaveLength(1);
    expect(graph.children[0].id).toBe("folder");
    expect(graph.children[0].children?.map((c) => c.id)).toEqual([
      "folder/a.ts",
      "folder/b.ts",
    ]);
    // Containers carry no size; ELK computes it.
    expect(graph.children[0].width).toBeUndefined();
  });

  it("sizes leaves from measured, falling back to style then a default", () => {
    const nodes = [
      node("measured", { measured: { width: 200, height: 44 } }),
      node("styled", { style: { width: 150 } }),
      node("plain"),
    ];
    const graph = buildElkGraph(nodes, []);
    const byId = new Map(graph.children.map((c) => [c.id, c]));
    expect(byId.get("measured")!.width).toBe(200);
    expect(byId.get("measured")!.height).toBe(44);
    expect(byId.get("styled")!.width).toBe(150);
    expect(byId.get("plain")!.width).toBe(180);
  });

  it("excludes hidden nodes and any edge touching them", () => {
    const nodes = [
      node("a"),
      node("b", { hidden: true }),
      node("c"),
    ];
    const edges: Edge[] = [
      { id: "a->b", source: "a", target: "b" },
      { id: "a->c", source: "a", target: "c" },
    ];
    const graph = buildElkGraph(nodes, edges);
    expect(graph.children.map((c) => c.id)).toEqual(["a", "c"]);
    expect(graph.edges.map((e) => e.id)).toEqual(["a->c"]);
  });

  it("sets orthogonal routing options", () => {
    const graph = buildElkGraph([node("a")], []);
    expect(graph.layoutOptions["elk.algorithm"]).toBe("layered");
    expect(graph.layoutOptions["elk.edgeRouting"]).toBe("ORTHOGONAL");
    expect(graph.layoutOptions["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
  });

  it("promotes a visible child whose parent is hidden", () => {
    const nodes = [
      node("folder", { hidden: true }),
      node("folder/a.ts", { parentId: "folder", measured: { width: 180, height: 60 } }),
    ];
    const graph = buildElkGraph(nodes, []);
    expect(graph.children.map((c) => c.id)).toEqual(["folder/a.ts"]);
  });

  it("parses string style sizes", () => {
    const graph = buildElkGraph([node("a", { style: { width: "220px" } })], []);
    expect(graph.children[0].width).toBe(220);
  });
});
