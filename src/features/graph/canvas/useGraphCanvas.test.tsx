import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useGraphCanvas, type DomainEdge } from "./useGraphCanvas";

/** The viewport calls, so a test can see whether the canvas reframed itself. */
const viewport = vi.hoisted(() => ({
  fitView: vi.fn(),
  fitBounds: vi.fn(),
  setCenter: vi.fn(),
  getZoom: vi.fn(() => 1),
  getInternalNode: vi.fn(() => ({
    internals: {
      positionAbsolute: { x: 0, y: 0 },
      userNode: { measured: { width: 10, height: 10 } },
    },
  })),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, useReactFlow: () => viewport };
});

const edge: DomainEdge = { id: "a->b", source: "a", target: "b" };

function node(id: string): Node {
  return { id, type: "scalpel", position: { x: 0, y: 0 }, data: {} };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

describe("useGraphCanvas", () => {
  it("runs the injected layout once per layoutKey and applies positions", async () => {
    const layout = vi.fn(async () => ({
      positions: { a: { x: 10, y: 20 } },
      sizes: {},
      sections: {},
    }));
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a")],
          edges: [edge],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper }
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(layout).toHaveBeenCalledTimes(1);
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({ x: 10, y: 20 });
  });

  it("falls back to the grid when layout returns null", async () => {
    const layout = vi.fn(async () => null);
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), node("b")],
          edges: [],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper }
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(result.current.nodes.every((n) => n.position.y >= 0)).toBe(true);
  });

  it("builds edges with the injected visibility", () => {
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), node("b")],
          edges: [edge],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "hidden",
          layout: async () => null,
        }),
      { wrapper }
    );
    expect(result.current.edges[0].style?.opacity).toBe(0);
    expect(result.current.edges[0].zIndex).toBe(0);
  });

  it("drops edges whose endpoints are hidden", () => {
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), { ...node("b"), hidden: true }],
          edges: [edge],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout: async () => null,
        }),
      { wrapper }
    );
    expect(result.current.edges).toHaveLength(0);
  });

  it("leaves placed nodes where they are when only their data changes", async () => {
    // Clearing a selection reskins the same nodes; it must not re-grid them.
    const layout = async () => ({
      positions: { a: { x: 10, y: 20 }, b: { x: 30, y: 40 } },
      sizes: {},
      sections: {},
    });
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useGraphCanvas({
          nodes: [
            { ...node("a"), data: { highlighted: active } },
            node("b"),
          ],
          edges: [],
          selection: active ? "a" : null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper, initialProps: { active: true } }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({
      x: 10,
      y: 20,
    });

    // Same nodes, different `data` — as a pane click produces.
    rerender({ active: false });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({
      x: 10,
      y: 20,
    });
    expect(result.current.nodes.find((n) => n.id === "b")?.position).toEqual({
      x: 30,
      y: 40,
    });
  });

  it("seeds a readable grid before any layout answers", () => {
    // A pending layout must not leave every block stacked on the origin.
    const { result } = renderHook(
      () =>
        useGraphCanvas({
          nodes: [node("a"), node("b"), node("c")],
          edges: [],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout: () => new Promise(() => {}),
        }),
      { wrapper }
    );
    const positions = result.current.nodes.map(
      (n) => `${n.position.x},${n.position.y}`
    );
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("ignores a stale layout result after the layoutKey changes", async () => {
    let release: () => void = () => {};
    const first = new Promise<void>((resolve) => (release = resolve));
    const layout = vi.fn()
      .mockImplementationOnce(async () => {
        await first;
        return { positions: { a: { x: 99, y: 99 } }, sizes: {}, sections: {} };
      })
      .mockImplementationOnce(async () => ({
        positions: { a: { x: 1, y: 1 } },
        sizes: {},
        sections: {},
      }));
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useGraphCanvas({
          nodes: [node("a")],
          edges: [],
          selection: null,
          layoutKey: key,
          fit: { token: key },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper, initialProps: { key: "one" } }
    );
    rerender({ key: "two" });
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(result.current.nodes.find((n) => n.id === "a")?.position).toEqual({ x: 1, y: 1 });
  });

  it("does not reframe a view the user has moved when a layout lands later", async () => {
    const layout = async () => ({ positions: { a: { x: 0, y: 0 } }, sizes: {}, sections: {} });
    const { result, rerender } = renderHook(
      ({ hidden }: { hidden: boolean }) =>
        useGraphCanvas({
          nodes: [node("a"), { ...node("b"), hidden }],
          edges: [],
          selection: null,
          layoutKey: "file",
          fit: { token: "file", target: "a" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper, initialProps: { hidden: false } }
    );

    // The first fit happens once the layout has answered.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(viewport.setCenter).toHaveBeenCalled();
    viewport.setCenter.mockClear();

    act(() => result.current.noteManualMove());

    // A change the layout watches — a re-measure does this — so a second layout
    // lands after the user has already taken over the viewport.
    rerender({ hidden: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(viewport.setCenter).not.toHaveBeenCalled();
  });

  it("frames a graph with no entry target once, after the layout has placed it", async () => {
    // The file graph fits with no target. Framing the seed grid before ELK places
    // the blocks leaves the graph off to one side of the viewport; waiting the full
    // timeout instead is what made it sit still then suddenly fit everything.
    const order: string[] = [];
    viewport.fitView.mockImplementation(() => {
      order.push("fitView");
    });
    const layout = async () => {
      order.push("layout");
      return { positions: {}, sizes: {}, sections: {} };
    };
    const { rerender } = renderHook(
      ({ hidden }: { hidden: boolean }) =>
        useGraphCanvas({
          nodes: [node("a"), { ...node("b"), hidden }],
          edges: [],
          selection: null,
          layoutKey: "file",
          fit: { token: "file" },
          edgeVisibility: () => "active",
          layout,
        }),
      { wrapper, initialProps: { hidden: false } }
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(viewport.fitView).toHaveBeenCalledTimes(1);
    // The framing came after the blocks were placed, not before.
    expect(order).toEqual(["layout", "fitView"]);

    // A re-measure the layout watches, so another pass lands for the same token.
    rerender({ hidden: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(viewport.fitView).toHaveBeenCalledTimes(1);
  });
});
