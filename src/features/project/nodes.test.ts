import { describe, it, expect } from "vitest";
import { folderChain, buildProjectNodes, decorateProjectNodes } from "./nodes";
import type { ProjectGraph } from "../../shared/types";

const data: ProjectGraph = {
  root: ".",
  truncated: false,
  folders: [
    { id: ".", name: "root", depth: 0 },
    { id: "src", name: "src", parentId: ".", depth: 1 },
  ],
  files: [
    { id: "src/a.ts", name: "a.ts", folderId: "src", kind: "code", imports: [] },
    { id: "src/b.ts", name: "b.ts", folderId: "src", kind: "code", imports: [{ targetId: "src/a.ts", specifier: "./a", names: ["x"] }] },
  ],
  edges: [{ source: "src/b.ts", target: "src/a.ts" }],
  entry: "src/b.ts",
  entries: ["src/b.ts"],
};

describe("folderChain", () => {
  it("walks parents to the root", () => {
    const byId = new Map(data.folders.map((f) => [f.id, f]));
    expect(folderChain("src", byId)).toEqual(["src", "."]);
  });
});

describe("buildProjectNodes", () => {
  it("renders files and nested folders but not the scope root", () => {
    const nodes = buildProjectNodes(data, new Set(), () => {});
    expect(nodes.map((n) => n.id).sort()).toEqual(["src", "src/a.ts", "src/b.ts"]);
  });

  it("mints entry files and greys external ones", () => {
    const nodes = buildProjectNodes(data, new Set(), () => {});
    expect((nodes.find((n) => n.id === "src/b.ts")?.data as { color: string }).color).toBe("#3DF0A8");
  });
});

describe("decorateProjectNodes", () => {
  it("hides descendants of a collapsed folder", () => {
    const nodes = decorateProjectNodes(buildProjectNodes(data, new Set(["src"]), () => {}), data, new Set(["src"]), null);
    expect(nodes.find((n) => n.id === "src/a.ts")?.hidden).toBe(true);
  });
});
