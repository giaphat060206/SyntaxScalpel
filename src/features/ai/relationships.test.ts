import { afterEach, describe, it, expect } from "vitest";
import type { FunctionGraph, ProjectGraph } from "../../shared/types";
import { fileRows, definitionRows, qualify, scopeRows } from "./relationships";

const graph: FunctionGraph = {
  file: {
    filePath: "algorithms/pathfinder.py",
    edges: [],
    nodes: [
      { id: "dijkstra", kind: "function", name: "dijkstra", params: [], returns: [] },
    ],
  },
  imports: { imports: [], importedBy: [] },
  externals: [
    {
      path: "utils/helpers.py",
      nodes: [{ id: "push", kind: "function", name: "push", params: [], returns: [] }],
    },
  ],
  crossEdges: [],
  residualImports: [],
  residualImportedBy: [],
  truncated: false,
};

const outgoing: FunctionGraph = {
  ...graph,
  crossEdges: [{ source: "dijkstra", target: "utils/helpers.py::push" }],
};

/** The same edge seen from the other file, which is what the payload gives. */
const incoming: FunctionGraph = {
  ...graph,
  file: {
    filePath: "utils/helpers.py",
    edges: [],
    nodes: [{ id: "push", kind: "function", name: "push", params: [], returns: [] }],
  },
  crossEdges: [{ source: "algorithms/pathfinder.py::dijkstra", target: "push" }],
};

describe("qualify", () => {
  it("leaves an already qualified end alone and qualifies a local one", () => {
    expect(qualify("utils/helpers.py::push", "a.py")).toBe("utils/helpers.py::push");
    expect(qualify("dijkstra", "algorithms/pathfinder.py")).toBe(
      "algorithms/pathfinder.py::dijkstra"
    );
  });
});

describe("relationship rows", () => {
  it("names the callee when the call leaves this file", () => {
    const rows = definitionRows(outgoing, "algorithms/pathfinder.py", ["dijkstra"]);

    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("calls");
    expect(rows[0].label).toBe("utils/helpers.py::push");
    expect(rows[0].counterpart).toBe("utils/helpers.py::push");
  });

  it("names the caller when the call arrives from another file", () => {
    const rows = definitionRows(incoming, "utils/helpers.py", ["push"]);

    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("called by");
    expect(rows[0].label).toBe("algorithms/pathfinder.py::dijkstra");
    expect(rows[0].counterpart).toBe("algorithms/pathfinder.py::dijkstra");
  });

  it("builds one identical pair whichever file is being read", () => {
    const fromTheCaller = definitionRows(outgoing, "algorithms/pathfinder.py", ["dijkstra"])[0];
    const fromTheCallee = definitionRows(incoming, "utils/helpers.py", ["push"])[0];

    expect(fromTheCaller.source).toBe(fromTheCallee.source);
    expect(fromTheCaller.target).toBe(fromTheCallee.target);
    expect(fromTheCaller.source).toBe("algorithms/pathfinder.py::dijkstra");
    expect(fromTheCaller.target).toBe("utils/helpers.py::push");
  });

  it("lists nothing until something is selected", () => {
    expect(definitionRows(outgoing, "algorithms/pathfinder.py", [])).toEqual([]);
    expect(definitionRows(outgoing, "algorithms/pathfinder.py", ["other"])).toEqual([]);
  });

  it("reads a file's imports and importers", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: [
        {
          id: "core/graph.py",
          name: "graph.py",
          folderId: "core",
          kind: "code",
          imports: [
            { targetId: "utils/constants.py", specifier: "utils.constants", names: ["WEIGHT"] },
            { targetId: "", specifier: "os", names: ["path"] },
          ],
        },
      ],
      edges: [],
      truncated: false,
    };

    const rows = fileRows("core/graph.py", project, {
      imports: [],
      importedBy: [{ path: "query/query.py", names: ["Graph"] }],
    });

    expect(rows.map((row) => [row.direction, row.label])).toEqual([
      ["imported by", "query/query.py"],
      ["imports", "utils/constants.py"],
    ]);
    expect(rows[1].source).toBe("core/graph.py");
    expect(rows[1].target).toBe("utils/constants.py");
    expect(rows[0].target).toBe("core/graph.py");
  });

  it("lists what a scope depends on, and only what leaves it", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: [
        { id: "core/graph.py", name: "graph.py", folderId: "core", kind: "code", imports: [] },
        { id: "outside.py", name: "outside.py", folderId: "", kind: "code", imports: [], external: true },
        { id: "core/other.py", name: "other.py", folderId: "core", kind: "code", imports: [] },
      ],
      edges: [
        { source: "core/graph.py", target: "outside.py" },
        { source: "core/graph.py", target: "core/other.py" },
      ],
      truncated: false,
    };

    const rows = scopeRows(project, "core");

    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("imports");
    expect(rows[0].label).toBe("outside.py");
  });
});

afterEach(() => {});
