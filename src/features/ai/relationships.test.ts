import { afterEach, describe, it, expect } from "vitest";
import type { FunctionGraph, ProjectGraph } from "../../shared/types";
import { fileRows, definitionRows, qualify, scopeRows, MAX_SCOPE_ROWS } from "./relationships";

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
  });

  it("names the caller when the call arrives from another file", () => {
    const rows = definitionRows(incoming, "utils/helpers.py", ["push"]);

    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("called by");
    expect(rows[0].label).toBe("algorithms/pathfinder.py::dijkstra");
  });

  it("builds one identical pair whichever file is being read", () => {
    const fromTheCaller = definitionRows(outgoing, "algorithms/pathfinder.py", ["dijkstra"])[0];
    const fromTheCallee = definitionRows(incoming, "utils/helpers.py", ["push"])[0];

    expect(fromTheCaller.source).toBe(fromTheCallee.source);
    expect(fromTheCaller.target).toBe(fromTheCallee.target);
    expect(fromTheCaller.source).toBe("algorithms/pathfinder.py::dijkstra");
    expect(fromTheCaller.target).toBe("utils/helpers.py::push");
  });

  it("names an imported definition's callers when that definition is the one chosen", () => {
    // The chosen end is in the dashed block, not this file, so the direction has
    // to come from whichever end it is — otherwise this lists nothing.
    const rows = definitionRows(outgoing, "algorithms/pathfinder.py", [
      "utils/helpers.py::push",
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("called by");
    expect(rows[0].label).toBe("algorithms/pathfinder.py::dijkstra");
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

  it("describes every edge from both ends, so both tags appear", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: [
        { id: "core/graph.py", name: "graph.py", folderId: "core", kind: "code", imports: [] },
        { id: "outside.py", name: "outside.py", folderId: "", kind: "code", imports: [], external: true },
        { id: "core/other.py", name: "other.py", folderId: "core", kind: "code", imports: [] },
      ],
      edges: [
        { source: "core/graph.py", target: "core/other.py" },
        { source: "core/graph.py", target: "outside.py" },
      ],
      truncated: false,
    };

    const listing = scopeRows(project, "core");

    expect(listing.rows.map((row) => [row.direction, row.label])).toEqual([
      // What reaches this side sits above what it reaches.
      ["imported by", "core/graph.py -> core/other.py"],
      ["imports", "core/graph.py -> core/other.py"],
      ["imports", "core/graph.py -> outside.py"],
    ]);
    expect(listing.rows[0].nodes).toEqual(["core/graph.py", "core/other.py"]);
    // An outside module being imported is the importing file's row, not its own.
    expect(listing.rows.some((row) => row.target === "outside.py" && row.direction === "imported by")).toBe(
      false
    );
    expect(listing.dropped).toBe(0);
  });

  it("puts every imported-by row above every imports row", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: ["a.py", "b.py", "c.py", "m.py", "z.py"].map((id) => ({
        id,
        name: id,
        folderId: "",
        kind: "code" as const,
        imports: [],
      })),
      edges: [
        { source: "a.py", target: "z.py" },
        { source: "b.py", target: "m.py" },
        { source: "c.py", target: "z.py" },
      ],
      truncated: false,
    };

    expect(scopeRows(project, "").rows.map((row) => [row.direction, row.label])).toEqual([
      // The upper half: who pulls these files in, grouped by the file pulled.
      ["imported by", "b.py -> m.py"],
      ["imported by", "a.py -> z.py"],
      ["imported by", "c.py -> z.py"],
      // The lower half: what these files pull in.
      ["imports", "a.py -> z.py"],
      ["imports", "b.py -> m.py"],
      ["imports", "c.py -> z.py"],
    ]);
  });

  it("calls one pair one question, however many import lines reach it", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: [
        { id: "a.py", name: "a.py", folderId: "", kind: "code", imports: [] },
        { id: "b.py", name: "b.py", folderId: "", kind: "code", imports: [] },
      ],
      edges: [
        { source: "a.py", target: "b.py" },
        { source: "a.py", target: "b.py" },
      ],
      truncated: false,
    };

    const rows = scopeRows(project, "").rows;

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => `${row.source}->${row.target}`)).size).toBe(1);
  });

  it("shows what imports a folder from elsewhere, but not edges between outsiders", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: ["core/a.py", "other/b.py", "third/c.py"].map((id) => ({
        id,
        name: id,
        folderId: id.split("/")[0],
        kind: "code" as const,
        imports: [],
      })),
      edges: [
        { source: "other/b.py", target: "core/a.py" },
        { source: "other/b.py", target: "third/c.py" },
      ],
      truncated: false,
    };

    expect(
      scopeRows(project, "core").rows.map((row) => [row.direction, row.label])
    ).toEqual([["imported by", "other/b.py -> core/a.py"]]);
  });

  it("ignores an edge whose other end was never a file it could see", () => {
    const project: ProjectGraph = {
      root: "/project",
      folders: [],
      files: [
        { id: "core/a.py", name: "a.py", folderId: "core", kind: "code", imports: [] },
      ],
      edges: [{ source: "../outside.py", target: "core/a.py" }],
      truncated: false,
    };

    expect(scopeRows(project, "core").rows).toEqual([]);
  });

  it("bounds a scope listing, because every row can be probed", () => {
    const files: ProjectGraph["files"] = Array.from(
      { length: MAX_SCOPE_ROWS + 20 },
      (_, index) => ({
        id: `f${index}.py`,
        name: `f${index}.py`,
        folderId: "",
        kind: "code" as const,
        imports: [],
      })
    );
    files.push({
      id: "outside.py",
      name: "outside.py",
      folderId: "",
      kind: "code" as const,
      imports: [],
      external: true,
    });

    // Every edge survives the scope rules, so only the cap can shorten the list.
    const edges = files
      .filter((file) => !file.external)
      .map((file) => ({ source: file.id, target: "outside.py" }));

    const listing = scopeRows({ root: "/", folders: [], files, edges, truncated: false }, "");

    expect(listing.rows).toHaveLength(MAX_SCOPE_ROWS);
    expect(listing.dropped).toBe(20);
  });
});

afterEach(() => {});
