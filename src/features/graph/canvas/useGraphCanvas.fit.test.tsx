import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const harness = vi.hoisted(() => ({
  state: { x: 0, y: 0, measured: true },
  setCenter: vi.fn(),
  fitView: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const useReactFlow = () => ({
    setCenter: harness.setCenter,
    fitView: harness.fitView,
    getInternalNode: (id: string) =>
      id === "entry" && harness.state.measured
        ? {
            internals: {
              positionAbsolute: { x: harness.state.x, y: harness.state.y },
              userNode: { measured: { width: 100, height: 50 } },
            },
          }
        : undefined,
  });
  return {
    ...actual,
    useReactFlow: useReactFlow as unknown as typeof actual.useReactFlow,
  };
});

import { useGraphCanvas } from "./useGraphCanvas";

afterEach(() => {
  vi.useRealTimers();
  harness.setCenter.mockClear();
  harness.fitView.mockClear();
  harness.state.x = 0;
  harness.state.y = 0;
  harness.state.measured = true;
});

describe("useGraphCanvas fit after layout", () => {
  it("re-centres on the target once a slow layout has applied", async () => {
    vi.useFakeTimers();
    const layout = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      harness.state.x = 500;
      harness.state.y = 500;
      return { positions: { entry: { x: 500, y: 500 } }, sizes: {}, sections: {} };
    });
    const node = { id: "entry", type: "scalpel", position: { x: 0, y: 0 }, data: {} };

    renderHook(() =>
      useGraphCanvas({
        nodes: [node],
        edges: [],
        selection: null,
        layoutKey: "scope",
        fit: { token: "scope", target: "entry" },
        edgeVisibility: () => "active",
        layout,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(harness.setCenter).toHaveBeenCalledWith(550, 525, expect.anything());
  });
});
