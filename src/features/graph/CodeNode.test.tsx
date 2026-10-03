import { describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { CodeNode, type CodeNodeData } from "./CodeNode";

function renderNode(data: CodeNodeData) {
  const props = { data, selected: false } as unknown as NodeProps;
  return render(
    <ReactFlowProvider>
      <CodeNode {...props} />
    </ReactFlowProvider>
  );
}

const definition = {
  id: "f",
  kind: "function" as const,
  name: "f",
  params: [],
  returns: [],
  uses: [],
};

describe("CodeNode external blocks", () => {
  it("draws the block standing for another file dashed, with an ext badge", () => {
    const { container } = renderNode({
      node: { ...definition, id: "pkg/file2.py", kind: "class", name: "file2.py" },
      external: "file",
      highlighted: false,
      dimmed: false,
    });

    expect(container.querySelector(".border-dashed")).not.toBeNull();
    expect(container.textContent).toContain("external file");
    expect(container.textContent).toContain("ext");
    cleanup();
  });

  it("draws a Definition inside another file dashed too", () => {
    const { container } = renderNode({
      node: { ...definition, id: "pkg/file2.py::Thing.run", name: "run" },
      external: "definition",
      highlighted: false,
      dimmed: false,
    });

    expect(container.querySelector(".border-dashed")).not.toBeNull();
    // It is still labelled by its own kind, not as a file.
    expect(container.textContent).toContain("function");
    cleanup();
  });

  it("leaves this file's own definitions solid", () => {
    const { container } = renderNode({
      node: definition,
      highlighted: false,
      dimmed: false,
    });

    expect(container.querySelector(".border-dashed")).toBeNull();
    cleanup();
  });
});
