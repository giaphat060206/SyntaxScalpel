import { describe, it, expect } from "vitest";
import type { ProjectGraph } from "../../shared/types";
import { selectionInfo } from "./selection";

function file(
  id: string,
  folderId: string,
  targets: string[] = []
): ProjectGraph["files"][number] {
  return {
    id,
    name: id.split("/").pop() ?? id,
    folderId,
    kind: id.endsWith(".md") ? "doc" : "code",
    imports: targets.map((targetId) => ({
      targetId,
      specifier: targetId,
      names: ["thing"],
    })),
  };
}

const graph: ProjectGraph = {
  root: ".",
  folders: [
    { id: ".", name: "root", depth: 0 },
    { id: "pkg", name: "pkg", parentId: ".", depth: 1 },
  ],
  files: [
    file("file1.py", ".", ["file2.py"]),
    file("file2.py", ".", ["file3.py"]),
    file("file3.py", "."),
    file("pkg/inner.py", "pkg", ["file1.py"]),
  ],
  edges: [
    { source: "file1.py", target: "file2.py" },
    { source: "file2.py", target: "file3.py" },
    { source: "pkg/inner.py", target: "file1.py" },
  ],
  truncated: false,
};

describe("selectionInfo", () => {
  it("focuses a file on its direct imports and importers only", () => {
    const selection = selectionInfo(graph, "file1.py")!;
    expect([...selection.focus]).toEqual(["file1.py"]);
    expect(selection.highlight.has("file2.py")).toBe(true);
    expect(selection.highlight.has("pkg/inner.py")).toBe(true);
    // file3 is only reachable through file2: not part of the selection.
    expect(selection.highlight.has("file3.py")).toBe(false);
  });

  it("focuses a folder on the files inside it", () => {
    const selection = selectionInfo(graph, "pkg")!;
    expect(selection.highlight.has("pkg")).toBe(true);
    expect(selection.highlight.has("pkg/inner.py")).toBe(true);
    expect(selection.highlight.has("file1.py")).toBe(true);
    expect(selection.highlight.has("file2.py")).toBe(false);
    expect([...selection.focus]).toEqual(["pkg/inner.py"]);
  });

  it("returns null with no selection", () => {
    expect(selectionInfo(graph, null)).toBeNull();
  });
});
