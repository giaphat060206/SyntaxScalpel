import { describe, it, expect } from "vitest";
import { buildFunctionNodes, decorateFunctionNodes } from "./nodes";
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
} from "./layout";
import type { ParseResult } from "../../shared/types";

const result: ParseResult = {
  filePath: "a.py",
  nodes: [
    { id: "Cls", kind: "class", name: "Cls", params: [], returns: [], uses: [] },
    { id: "Cls.m", kind: "method", name: "m", params: [], returns: [], uses: [], parent: "Cls" },
    { id: "V", kind: "variable", name: "V", params: [], returns: [], uses: [], value: "1" },
    { id: "f", kind: "function", name: "f", params: ["x"], returns: [], uses: [] },
  ],
  edges: [{ source: "f", target: "Cls.m" }],
};

describe("buildFunctionNodes", () => {
  it("groups variables under a CONSTANTS container", () => {
    const nodes = buildFunctionNodes(result, null);
    const constants = nodes.find((n) => n.id === CONSTANTS_NODE_ID);
    expect(constants).toBeDefined();
    expect(nodes.find((n) => n.id === "V")?.parentId).toBe(CONSTANTS_NODE_ID);
  });

  it("marks classes owning an edge endpoint as transparent", () => {
    const nodes = buildFunctionNodes(result, null);
    expect((nodes.find((n) => n.id === "Cls")?.data as { transparent?: boolean }).transparent).toBe(true);
  });

  it("appends IMPORTS and IMPORTED BY special blocks when analysis is present", () => {
    const nodes = buildFunctionNodes(result, { imports: [], importedBy: [] });
    expect(nodes.map((n) => n.id)).toContain(IMPORTS_NODE_ID);
    expect(nodes.map((n) => n.id)).toContain(IMPORTED_BY_NODE_ID);
  });

  it("makes method nodes children of their class with parent extent", () => {
    const nodes = buildFunctionNodes(result, null);
    const method = nodes.find((n) => n.id === "Cls.m");
    expect(method?.parentId).toBe("Cls");
    expect(method?.extent).toBe("parent");
  });

  it("sizes a class node to fit its methods", () => {
    const nodes = buildFunctionNodes(result, null);
    expect(nodes.find((n) => n.id === "Cls")?.style).toEqual({ width: 240, height: 150 });
  });
});

describe("decorateFunctionNodes", () => {
  it("highlights the 1-hop trace and dims the rest", () => {
    const nodes = decorateFunctionNodes(buildFunctionNodes(result, null), result.edges, "f");
    expect((nodes.find((n) => n.id === "f")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "Cls.m")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "V")?.data as { dimmed: boolean }).dimmed).toBe(true);
  });
});
