import { describe, it, expect } from "vitest";
import { buildFunctionNodes, crossFileNodeIdForName, crossFileNodeIdForPath, decorateFunctionNodes } from "./nodes";
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
} from "./layout";
import type { ExternalFile, FunctionGraph, ParseResult } from "../../shared/types";

function graph(
  file: ParseResult,
  options: {
    externals?: ExternalFile[];
    crossEdges?: FunctionGraph["crossEdges"];
    residualImports?: FunctionGraph["residualImports"];
    residualImportedBy?: FunctionGraph["residualImportedBy"];
  } = {}
): FunctionGraph {
  return {
    file,
    imports: { imports: [], importedBy: [] },
    externals: options.externals ?? [],
    crossEdges: options.crossEdges ?? [],
    residualImports: options.residualImports ?? [],
    residualImportedBy: options.residualImportedBy ?? [],
    truncated: false,
  };
}

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

const externalFile: ExternalFile = {
  path: "pkg/file2.py",
  nodes: [
    {
      id: "pkg/file2.py::Thing.run",
      kind: "method",
      name: "run",
      params: [],
      returns: [],
      uses: [],
      startLine: 3,
      endLine: 5,
      parent: "pkg/file2.py",
    },
  ],
};

describe("buildFunctionNodes", () => {
  it("groups variables under a CONSTANTS container", () => {
    const nodes = buildFunctionNodes(graph(result));
    const constants = nodes.find((n) => n.id === CONSTANTS_NODE_ID);
    expect(constants).toBeDefined();
    expect(nodes.find((n) => n.id === "V")?.parentId).toBe(CONSTANTS_NODE_ID);
  });

  it("marks classes owning an edge endpoint as transparent", () => {
    const nodes = buildFunctionNodes(graph(result));
    expect((nodes.find((n) => n.id === "Cls")?.data as { transparent?: boolean }).transparent).toBe(true);
  });

  it("omits the text blocks when every import was drawn", () => {
    const nodes = buildFunctionNodes(graph(result));
    expect(nodes.map((n) => n.id)).not.toContain(IMPORTS_NODE_ID);
    expect(nodes.map((n) => n.id)).not.toContain(IMPORTED_BY_NODE_ID);
  });

  it("lists imports and importers no block could draw", () => {
    const nodes = buildFunctionNodes(
      graph(result, {
        residualImports: [{ specifier: "os", names: [] }],
        residualImportedBy: [{ path: "b.py", names: ["f"] }],
      })
    );
    expect(nodes.map((n) => n.id)).toContain(IMPORTS_NODE_ID);
    expect(nodes.map((n) => n.id)).toContain(IMPORTED_BY_NODE_ID);
  });

  it("makes method nodes children of their class with parent extent", () => {
    const nodes = buildFunctionNodes(graph(result));
    const method = nodes.find((n) => n.id === "Cls.m");
    expect(method?.parentId).toBe("Cls");
    expect(method?.extent).toBe("parent");
  });

  it("sizes a class node to fit its methods", () => {
    const nodes = buildFunctionNodes(graph(result));
    expect(nodes.find((n) => n.id === "Cls")?.style).toEqual({ width: 240, height: 150 });
  });
});

describe("buildFunctionNodes for external files", () => {
  it("draws a dashed block per file, holding only the reached definitions", () => {
    const nodes = buildFunctionNodes(graph(result, { externals: [externalFile] }));
    const block = nodes.find((n) => n.id === "pkg/file2.py");
    expect(block).toBeDefined();
    expect((block?.data as { crossFile?: string }).crossFile).toBe("file");
    expect((block?.data as { node?: { name: string } }).node?.name).toBe("file2.py");

    const definition = nodes.find((n) => n.id === "pkg/file2.py::Thing.run");
    expect(definition?.parentId).toBe("pkg/file2.py");
    expect(definition?.extent).toBe("parent");
    expect((definition?.data as { crossFile?: string }).crossFile).toBe("definition");
  });

  it("keeps every external definition attached to a block that exists", () => {
    const nodes = buildFunctionNodes(graph(result, { externals: [externalFile] }));
    const ids = new Set(nodes.map((n) => n.id));
    for (const node of nodes) {
      if (node.parentId) {
        expect(ids.has(node.parentId)).toBe(true);
      }
    }
  });

  it("marks an external block holding an edge endpoint transparent", () => {
    const nodes = buildFunctionNodes(
      graph(result, {
        externals: [externalFile],
        crossEdges: [{ source: "f", target: "pkg/file2.py::Thing.run" }],
      })
    );
    const block = nodes.find((n) => n.id === "pkg/file2.py");
    expect((block?.data as { transparent?: boolean }).transparent).toBe(true);
  });

  it("traces a cross-file edge", () => {
    const g = graph(result, {
      externals: [externalFile],
      crossEdges: [{ source: "f", target: "pkg/file2.py::Thing.run" }],
    });
    const edges = [...g.file.edges, ...g.crossEdges];
    const nodes = decorateFunctionNodes(buildFunctionNodes(g), edges, "f");
    expect((nodes.find((n) => n.id === "pkg/file2.py::Thing.run")?.data as { highlighted: boolean }).highlighted).toBe(true);
  });
});

describe("decorateFunctionNodes", () => {
  it("highlights the 1-hop trace and dims the rest", () => {
    const g = graph(result);
    const nodes = decorateFunctionNodes(buildFunctionNodes(g), g.file.edges, "f");
    expect((nodes.find((n) => n.id === "f")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "Cls.m")?.data as { highlighted: boolean }).highlighted).toBe(true);
    expect((nodes.find((n) => n.id === "V")?.data as { dimmed: boolean }).dimmed).toBe(true);
  });
});

describe("cross-file jump targets", () => {
  const nodes = buildFunctionNodes(graph(result, { externals: [externalFile] }));

  it("points a used name at the definition a dashed block holds", () => {
    expect(crossFileNodeIdForName(nodes, "run")).toBe("pkg/file2.py::Thing.run");
  });

  it("points a used name at the block holding a member of it", () => {
    // `Thing` itself is not drawn here, only `Thing.run`.
    expect(crossFileNodeIdForName(nodes, "Thing")).toBe("pkg/file2.py");
  });

  it("has no target for a name or path no block shows", () => {
    expect(crossFileNodeIdForName(nodes, "os")).toBeNull();
    expect(crossFileNodeIdForPath(nodes, "pkg/other.py")).toBeNull();
  });

  it("points an importer path at its dashed block", () => {
    expect(crossFileNodeIdForPath(nodes, "pkg/file2.py")).toBe("pkg/file2.py");
  });

  it("never points at this file's own definitions", () => {
    expect(crossFileNodeIdForName(nodes, "f")).toBeNull();
    expect(crossFileNodeIdForPath(nodes, "a.py")).toBeNull();
  });
});

const rustResult: ParseResult = {
  filePath: "src/lib.rs",
  nodes: [
    { id: "Point", kind: "class", name: "Point", params: [], returns: [], uses: [] },
    {
      id: "Point.new",
      kind: "method",
      name: "new",
      params: ["x: i32"],
      returns: [],
      uses: [],
      parent: "Point",
    },
    { id: "SCALE", kind: "variable", name: "SCALE", params: [], returns: [], uses: [], value: "10" },
    {
      id: "helper",
      kind: "function",
      name: "helper",
      params: ["value: i32"],
      returns: ["value"],
      uses: [],
    },
    { id: "tests", kind: "class", name: "tests", params: [], returns: [], uses: [] },
    {
      id: "tests.inside",
      kind: "method",
      name: "inside",
      params: [],
      returns: [],
      uses: [],
      parent: "tests",
    },
  ],
  edges: [{ source: "Point.new", target: "helper" }],
};

describe("buildFunctionNodes for a Rust payload", () => {
  it("renders every definition the backend sent", () => {
    const ids = buildFunctionNodes(graph(rustResult)).map((node) => node.id);
    for (const node of rustResult.nodes) {
      expect(ids).toContain(node.id);
    }
  });

  it("nests impl and module methods inside their containers", () => {
    const nodes = buildFunctionNodes(graph(rustResult));
    expect(nodes.find((n) => n.id === "Point.new")?.parentId).toBe("Point");
    expect(nodes.find((n) => n.id === "tests.inside")?.parentId).toBe("tests");
  });

  it("still groups Rust constants under the CONSTANTS container", () => {
    const nodes = buildFunctionNodes(graph(rustResult));
    expect(nodes.find((n) => n.id === "SCALE")?.parentId).toBe(CONSTANTS_NODE_ID);
  });
});
