import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ProjectGraph } from "../../shared/types";

const mocks = vi.hoisted(() => ({ projectGraph: vi.fn() }));

vi.mock("../../shared/ipc", () => ({ projectGraph: mocks.projectGraph }));

import { useProjectGraph } from "./useProjectGraph";

function payload(root: string): ProjectGraph {
  return { root, folders: [], files: [], edges: [], truncated: false };
}

beforeEach(() => {
  mocks.projectGraph.mockReset();
  mocks.projectGraph.mockImplementation((root: string) => Promise.resolve(payload(root)));
});

describe("useProjectGraph", () => {
  it("scans the folder, root first", async () => {
    const { result } = renderHook(() => useProjectGraph("/root", "src"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.projectGraph).toHaveBeenCalledWith("/root", "src");
    expect(mocks.projectGraph).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ status: "ready", value: { root: "/root" } });
  });

  it("scans the root folder, whose scope is the empty string", async () => {
    const { result } = renderHook(() => useProjectGraph("/root", ""));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.projectGraph).toHaveBeenCalledWith("/root", "");
  });

  it("does not scan without a project, or without a scope", () => {
    const noRoot = renderHook(() => useProjectGraph(null, "src"));
    expect(noRoot.result.current.status).toBe("idle");

    const noScope = renderHook(() => useProjectGraph("/root", null));
    expect(noScope.result.current.status).toBe("idle");

    expect(mocks.projectGraph).not.toHaveBeenCalled();
  });

  it("does not scan again when the same folder is asked for twice", async () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useProjectGraph("/root", scope),
      { initialProps: { scope: "src" } }
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ scope: "src" });

    // Switching between two views of one folder must reuse the one scan.
    expect(mocks.projectGraph).toHaveBeenCalledTimes(1);
  });

  it("scans again for a different folder", async () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) => useProjectGraph("/root", scope),
      { initialProps: { scope: "src" } }
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ scope: "src/parser" });

    await waitFor(() =>
      expect(result.current).toMatchObject({ status: "ready", value: { root: "/root" } })
    );
    expect(mocks.projectGraph).toHaveBeenCalledTimes(2);
    expect(mocks.projectGraph).toHaveBeenLastCalledWith("/root", "src/parser");
  });
});
