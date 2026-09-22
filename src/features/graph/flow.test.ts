import { describe, it, expect } from "vitest";
import { buildFlow } from "./flow";
import type { ParseResult } from "../../shared/types";

const result: ParseResult = {
  filePath: "src/main.py",
  nodes: [
    { id: "helper", kind: "function", name: "helper", params: [], returns: [] },
    { id: "Greeter", kind: "class", name: "Greeter", params: [], returns: [] },
    {
      id: "Greeter.greet",
      kind: "method",
      name: "greet",
      params: ["self"],
      returns: [],
      parent: "Greeter",
    },
  ],
  edges: [{ source: "Greeter.greet", target: "helper" }],
};

describe("buildFlow", () => {
  it("makes method nodes children of their class with parent extent", () => {
    const { nodes } = buildFlow(result);
    const method = nodes.find((n) => n.id === "Greeter.greet")!;
    expect(method.parentId).toBe("Greeter");
    expect(method.extent).toBe("parent");
  });

  it("sizes the class node to fit its methods", () => {
    const { nodes } = buildFlow(result);
    const cls = nodes.find((n) => n.id === "Greeter")!;
    expect(cls.style).toEqual({ width: 240, height: 150 });
  });

  it("auto-lays out top-level nodes in a column when no saved position", () => {
    const { nodes } = buildFlow(result);
    const helper = nodes.find((n) => n.id === "helper")!;
    const cls = nodes.find((n) => n.id === "Greeter")!;
    expect(helper.position).toEqual({ x: 0, y: 0 });
    expect(cls.position).toEqual({ x: 0, y: 130 });
  });

  it("uses saved positions when present", () => {
    const saved: ParseResult = {
      ...result,
      nodes: result.nodes.map((n) =>
        n.id === "helper" ? { ...n, position: { x: 500, y: 42 } } : n
      ),
    };
    const { nodes } = buildFlow(saved);
    expect(nodes.find((n) => n.id === "helper")!.position).toEqual({ x: 500, y: 42 });
  });

  it("emits orthogonal step edges", () => {
    const { edges } = buildFlow(result);
    expect(edges).toEqual([
      { id: "Greeter.greet->helper", source: "Greeter.greet", target: "helper", type: "step" },
    ]);
  });
});
