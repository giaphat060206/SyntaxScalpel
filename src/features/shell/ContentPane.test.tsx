import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContentPane } from "./ContentPane";
import type { FunctionGraph } from "../../shared/types";

const graphProps = vi.fn();
const sourceArgs = vi.fn();

// Hoisted so the mock factories can read the payload the test sets.
const state = vi.hoisted(() => ({ payload: null as unknown }));

vi.mock("../graph/GraphView", () => ({
  GraphView: (props: {
    selectedId: string | null;
    onSelect: (id: string | null) => void;
  }) => {
    graphProps(props.selectedId);
    return (
      <button type="button" onClick={() => props.onSelect("GET")}>
        select-stub
      </button>
    );
  },
}));

vi.mock("./useFileContent", () => ({
  useFileContent: () => ({ status: "graph", graph: state.payload }),
}));

vi.mock("./useSource", () => ({
  useSource: (root: string | null, path: string | null, enabled: boolean) => {
    sourceArgs(root, path, enabled);
    return null;
  },
}));

function payload(externals: FunctionGraph["externals"]): FunctionGraph {
  return {
    file: {
      filePath: "a.py",
      edges: [],
      nodes: [
        {
          id: "GET",
          kind: "function",
          name: "GET",
          params: [],
          returns: [],
          startLine: 1,
          endLine: 3,
        },
      ],
    },
    imports: { imports: [], importedBy: [] },
    externals,
    crossEdges: [],
    residualImports: [],
    residualImportedBy: [],
    truncated: false,
  };
}

const externalDefinition = {
  id: "pkg/file2.py::Thing.run",
  kind: "method" as const,
  name: "run",
  params: [],
  returns: [],
  uses: [],
  startLine: 3,
  endLine: 5,
  parent: "pkg/file2.py",
};

afterEach(() => {
  cleanup();
  graphProps.mockReset();
  sourceArgs.mockReset();
  state.payload = null;
});

describe("ContentPane initial selection", () => {
  it("selects the definition named by initialSelectedId", () => {
    state.payload = payload([]);
    render(
      <ContentPane root="proj" filePath="a.py" initialSelectedId="GET" />
    );
    expect(graphProps).toHaveBeenCalledWith("GET");
  });

  it("has no selection when initialSelectedId is absent", () => {
    state.payload = payload([]);
    render(<ContentPane root="proj" filePath="a.py" />);
    expect(graphProps).toHaveBeenCalledWith(null);
  });

  it("tells the shell which definition the graph selected", () => {
    const onSelect = vi.fn();
    state.payload = payload([]);
    render(<ContentPane root="proj" filePath="a.py" onSelect={onSelect} />);

    fireEvent.click(screen.getByText("select-stub"));

    expect(onSelect).toHaveBeenCalledWith("GET");
  });
});

describe("ContentPane external definitions", () => {
  it("reads the other file when an external definition is picked", () => {
    state.payload = payload([
      { path: "pkg/file2.py", nodes: [externalDefinition] },
    ]);
    render(
      <ContentPane
        root="proj"
        filePath="a.py"
        initialSelectedId="pkg/file2.py::Thing.run"
      />
    );
    expect(sourceArgs).toHaveBeenCalledWith("proj", "pkg/file2.py", true);
  });

  it("reads nothing when the dashed block itself is picked", () => {
    state.payload = payload([
      { path: "pkg/file2.py", nodes: [externalDefinition] },
    ]);
    render(
      <ContentPane root="proj" filePath="a.py" initialSelectedId="pkg/file2.py" />
    );
    expect(sourceArgs).toHaveBeenCalledWith("proj", null, true);
  });
});
