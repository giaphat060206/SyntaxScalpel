import { afterEach, describe, it, expect, vi } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  __setElkFactoryForTests,
  __setElkLayoutForTests,
  runElkLayout,
} from "./layout";

function node(id: string): Node {
  return { id, type: "scalpel", position: { x: 0, y: 0 }, data: {} };
}

afterEach(() => {
  __setElkLayoutForTests(null);
  __setElkFactoryForTests(null);
});

describe("runElkLayout", () => {
  it("returns null above the node cap", async () => {
    const nodes = Array.from({ length: 1501 }, (_, index) => node(`n${index}`));
    expect(await runElkLayout(nodes, [])).toBeNull();
  });

  it("returns null when the layout throws", async () => {
    __setElkLayoutForTests(async () => {
      throw new Error("boom");
    });
    expect(await runElkLayout([node("a")], [] as Edge[])).toBeNull();
  });

  it("maps a successful layout", async () => {
    __setElkLayoutForTests(async () => ({
      children: [{ id: "a", x: 5, y: 7, width: 180, height: 60 }],
      edges: [],
    }));
    const result = await runElkLayout([node("a")], []);
    expect(result?.positions.a).toEqual({ x: 5, y: 7 });
  });

  it("uses the factory fallback when the worker build is unavailable", async () => {
    __setElkFactoryForTests(() => ({
      layout: async () => ({
        children: [{ id: "a", x: 1, y: 2, width: 180, height: 60 }],
        edges: [],
      }),
    }));
    const result = await runElkLayout([node("a")], []);
    expect(result?.positions.a).toEqual({ x: 1, y: 2 });
  });

  it("returns null when the layout never settles", async () => {
    vi.useFakeTimers();
    __setElkLayoutForTests(() => new Promise(() => {}));
    const pending = runElkLayout([node("a")], []);
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toBeNull();
    vi.useRealTimers();
  });
});
