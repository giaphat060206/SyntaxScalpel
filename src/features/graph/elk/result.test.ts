import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { applyElkResult } from "./result";

function node(id: string, parentId?: string): Node {
  return {
    id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    data: {},
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
  };
}

const elkResult = {
  children: [
    {
      id: "folder",
      x: 100,
      y: 50,
      width: 300,
      height: 200,
      children: [
        { id: "folder/a.ts", x: 20, y: 40, width: 180, height: 60 },
        { id: "folder/b.ts", x: 20, y: 120, width: 180, height: 60 },
      ],
    },
    { id: "top.ts", x: 0, y: 0, width: 180, height: 60 },
  ],
  edges: [
    {
      id: "folder/a.ts->folder/b.ts",
      sources: ["folder/a.ts"],
      sections: [
        {
          startPoint: { x: 110, y: 100 },
          bendPoints: [{ x: 110, y: 150 }],
          endPoint: { x: 110, y: 170 },
        },
      ],
    },
  ],
};

describe("applyElkResult", () => {
  it("keeps node positions parent-relative", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    expect(result.positions["folder"]).toEqual({ x: 100, y: 50 });
    expect(result.positions["folder/a.ts"]).toEqual({ x: 20, y: 40 });
  });

  it("records container sizes only", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    expect(result.sizes["folder"]).toEqual({ width: 300, height: 200 });
  });

  it("converts sections to absolute coordinates through the source container", () => {
    const result = applyElkResult([node("folder"), node("folder/a.ts", "folder")], elkResult);
    // folder is at (100,50); the section is relative to the folder's graph.
    expect(result.sections["folder/a.ts->folder/b.ts"]).toEqual([
      { x: 210, y: 150 },
      { x: 210, y: 200 },
      { x: 210, y: 220 },
    ]);
  });

  it("skips edges without sections", () => {
    const result = applyElkResult(
      [node("a"), node("b")],
      { children: [], edges: [{ id: "a->b", sources: ["a"], sections: [] }] }
    );
    expect(result.sections["a->b"]).toBeUndefined();
  });
});
