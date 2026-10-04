import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { functionGraph, projectGraph } from "../../shared/ipc";
import type { FunctionGraph, ProjectGraph } from "../../shared/types";
import { DefinitionPicker } from "./DefinitionPicker";
import { FilePicker } from "./FilePicker";

vi.mock("../../shared/ipc", () => ({
  projectGraph: vi.fn(),
  functionGraph: vi.fn(),
}));

const scope: ProjectGraph = {
  root: "/project",
  folders: [
    { id: "", name: "project", depth: 0 },
    { id: "core", name: "core", parentId: "", depth: 1 },
  ],
  files: [
    { id: "core/graph.py", name: "graph.py", folderId: "core", kind: "code", imports: [] },
    { id: "core/path.py", name: "path.py", folderId: "core", kind: "code", imports: [] },
    { id: "main.py", name: "main.py", folderId: "", kind: "code", imports: [] },
    {
      id: "outside/lib.py",
      name: "lib.py",
      folderId: "outside",
      kind: "code",
      imports: [],
      external: true,
    },
  ],
  edges: [],
  truncated: false,
};

const graph: FunctionGraph = {
  file: {
    filePath: "algorithms/pathfinder.py",
    edges: [],
    nodes: [
      { id: "PathFinder", kind: "class", name: "PathFinder", params: [], returns: [] },
      {
        id: "PathFinder.dijkstra",
        kind: "method",
        name: "dijkstra",
        params: [],
        returns: [],
        parent: "PathFinder",
      },
      { id: "main", kind: "function", name: "main", params: [], returns: [] },
    ],
  },
  imports: { imports: [], importedBy: [] },
  externals: [
    {
      path: "core/path.py",
      // The parser qualifies an external Definition's id itself.
      nodes: [{ id: "core/path.py::Path", kind: "class", name: "Path", params: [], returns: [] }],
    },
  ],
  crossEdges: [],
  residualImports: [],
  residualImportedBy: [],
  truncated: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FilePicker", () => {
  it("picks every file beneath a folder at once", async () => {
    vi.mocked(projectGraph).mockResolvedValue(scope);
    const onChange = vi.fn();
    render(<FilePicker root="/project" scope="" selected={[]} onChange={onChange} />);

    const core = (await screen.findByLabelText("core")) as HTMLInputElement;
    fireEvent.click(core);

    expect(onChange).toHaveBeenCalledWith(["core/graph.py", "core/path.py"]);
  });

  it("clears a folder's files when unchecked", async () => {
    vi.mocked(projectGraph).mockResolvedValue(scope);
    const onChange = vi.fn();
    render(
      <FilePicker
        root="/project"
        scope=""
        selected={["core/graph.py", "core/path.py", "main.py"]}
        onChange={onChange}
      />
    );

    const core = (await screen.findByLabelText("core")) as HTMLInputElement;
    expect(core.checked).toBe(true);
    fireEvent.click(core);

    expect(onChange).toHaveBeenCalledWith(["main.py"]);
  });

  it("leaves files outside the scope out of the tree", async () => {
    vi.mocked(projectGraph).mockResolvedValue(scope);
    render(<FilePicker root="/project" scope="" selected={[]} onChange={vi.fn()} />);

    await screen.findByLabelText("core");
    expect(screen.queryByText("lib.py")).toBeNull();
  });

  it("says so when a scope holds no code", async () => {
    vi.mocked(projectGraph).mockResolvedValue({ ...scope, files: [] });
    render(<FilePicker root="/project" scope="" selected={[]} onChange={vi.fn()} />);

    await screen.findByText("no code files in this scope");
  });
});

describe("DefinitionPicker", () => {
  it("lists this file's definitions and the ones its cross-file blocks show", async () => {
    vi.mocked(functionGraph).mockResolvedValue(graph);
    const onChange = vi.fn();
    render(
      <DefinitionPicker graph={graph} error={null}
        selected={[]}
        onChange={onChange}
      />
    );

    await screen.findByText("class PathFinder");
    expect(screen.getByText("dijkstra")).toBeTruthy();
    expect(screen.getByText("fn main")).toBeTruthy();
    expect(screen.getByText("from core/path.py")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("class Path"));
    expect(onChange).toHaveBeenCalledWith(["core/path.py::Path"]);
  });

  it("hands back the plain id for a definition of this file", async () => {
    vi.mocked(functionGraph).mockResolvedValue(graph);
    const onChange = vi.fn();
    render(
      <DefinitionPicker graph={graph} error={null}
        selected={["main"]}
        onChange={onChange}
      />
    );

    const main = (await screen.findByLabelText("fn main")) as HTMLInputElement;
    expect(main.checked).toBe(true);
    fireEvent.click(main);

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("reports a failure to read the file", async () => {
    vi.mocked(functionGraph).mockRejectedValue(new Error("no such file"));
    render(
      <DefinitionPicker graph={null} error="no such file" selected={[]} onChange={vi.fn()} />
    );

    await waitFor(() => expect(screen.getByText(/no such file/)).toBeTruthy());
  });
});
