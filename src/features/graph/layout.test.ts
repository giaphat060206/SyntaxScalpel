import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { arrangeGrid, pickHandles, reflowLayout } from "./layout";

function node(id: string, x: number, y: number, width = 200, height = 80): Node {
  return {
    id,
    type: "scalpel",
    position: { x, y },
    style: { width },
    measured: { width, height },
    data: {},
  };
}

describe("arrangeGrid", () => {
  it("lays nine items in a 3x3 grid", () => {
    const items = Array.from({ length: 9 }, (_, i) => node(`n${i}`, 0, 0));
    const { positions } = arrangeGrid(items, 0, 0, 10, 10);
    expect(positions[3]).toEqual({ x: 0, y: 90 });
    expect(positions[4]).toEqual({ x: 210, y: 90 });
    expect(positions[8]).toEqual({ x: 420, y: 180 });
  });

  it("sizes each column from its longest block", () => {
    const items = [
      node("a", 0, 0, 200),
      node("c", 0, 0, 200),
      node("b", 0, 0, 400),
      node("d", 0, 0, 200),
    ];
    const { positions } = arrangeGrid(items, 0, 0, 10, 10);
    // Two columns: column 0 widest is 400, so column 1 starts at 410.
    expect(positions[1]).toEqual({ x: 410, y: 0 });
  });
});

describe("reflowLayout", () => {
  it("positions class children and sizes the parent", () => {
    const parent: Node = {
      id: "C",
      type: "scalpel",
      position: { x: 0, y: 0 },
      data: {},
      style: { width: 240 },
      measured: { width: 240, height: 100 },
    };
    const first: Node = {
      id: "C.a",
      type: "scalpel",
      position: { x: 0, y: 0 },
      parentId: "C",
      extent: "parent",
      data: {},
      style: { width: 200 },
      measured: { width: 200, height: 60 },
    };
    const second: Node = { ...first, id: "C.b" };

    const out = reflowLayout([parent, first, second]);
    const child = out.find((node) => node.id === "C.a")!;
    expect(child.position.y).toBeGreaterThan(0);
    expect((out[0].style as { height?: number }).height).toBeGreaterThan(100);
  });

  it("ignores hidden children so a collapsed parent shrinks", () => {
    const parent: Node = {
      id: "C",
      type: "scalpel",
      position: { x: 0, y: 0 },
      data: {},
      style: { width: 240 },
      measured: { width: 240, height: 100 },
    };
    const visible: Node = {
      id: "C.a",
      type: "scalpel",
      position: { x: 0, y: 0 },
      parentId: "C",
      extent: "parent",
      data: {},
      style: { width: 200 },
      measured: { width: 200, height: 60 },
    };
    const hidden: Node = { ...visible, id: "C.b", hidden: true };

    const withHidden = reflowLayout([parent, visible, hidden]);
    const withoutHidden = reflowLayout([parent, visible]);
    expect((withHidden[0].style as { height?: number }).height).toBe(
      (withoutHidden[0].style as { height?: number }).height
    );
  });
});

describe("pickHandles", () => {
  it("uses right to left when the target is to the right", () => {
    const byId = new Map<string, Node>([
      ["a", node("a", 0, 0)],
      ["b", node("b", 400, 0)],
    ]);
    expect(pickHandles(byId.get("a")!, byId.get("b")!, byId)).toEqual({
      sourceHandle: "r-out",
      targetHandle: "l-in",
    });
  });

  it("uses top to bottom when the target is above", () => {
    const byId = new Map<string, Node>([
      ["a", node("a", 0, 300)],
      ["b", node("b", 0, 0)],
    ]);
    expect(pickHandles(byId.get("a")!, byId.get("b")!, byId)).toEqual({
      sourceHandle: "t-out",
      targetHandle: "b-in",
    });
  });
});
