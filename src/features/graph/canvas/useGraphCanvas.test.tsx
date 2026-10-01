import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useGraphCanvas, type DomainEdge } from "./useGraphCanvas";

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
});
