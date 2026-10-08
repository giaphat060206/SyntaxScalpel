import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import type { ProjectGraph } from "../../shared/types";
import type { TourStep } from "./plan";

const mocks = vi.hoisted(() => ({
  aiSummary: vi.fn(),
  aiCached: vi.fn(),
  settings: { provider: "openrouter", model: "some/model", ready: true, hasKey: true },
}));

vi.mock("../../shared/ipc", () => ({
  aiSummary: mocks.aiSummary,
  aiCached: mocks.aiCached,
}));

vi.mock("../ai/useAiSettings", () => ({
  useAiSettings: () => ({
    provider: mocks.settings.provider,
    model: mocks.settings.model,
    ready: mocks.settings.ready,
    hasKey: mocks.settings.hasKey,
    error: null,
    saveKey: vi.fn(),
    clearKey: vi.fn(),
    setProvider: vi.fn(),
    setModel: vi.fn(),
  }),
}));

import { isConfirmed } from "../ai/egress";
import { useTourProse } from "./useTourProse";

afterEach(cleanup);

const graph: ProjectGraph = {
  root: ".",
  folders: [{ id: ".", name: "project", depth: 0 }],
  files: [
    { id: "main.py", name: "main.py", folderId: ".", kind: "code", sizeBytes: 10, imports: [] },
  ],
  edges: [],
  truncated: false,
  entry: "main.py",
};

const steps: TourStep[] = [
  { nodeId: ".", kind: "orientation", alsoIds: [], depth: null, dependents: 0 },
  { nodeId: "main.py", kind: "entry", alsoIds: [], depth: 0, dependents: 0 },
];

function answer(text: string) {
  return {
    key: "k",
    text,
    task: "tour-stop",
    provider: "openrouter",
    model: "some/model",
    cached: false,
    truncated: false,
    createdAtMs: 0,
    inputTokens: 1,
    outputTokens: 1,
  };
}

function tour() {
  return renderHook(() => useTourProse("/home/me/pathfinder", "", graph, steps));
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.aiSummary.mockReset();
  mocks.aiCached.mockReset().mockResolvedValue([false, false]);
  mocks.settings = { provider: "openrouter", model: "some/model", ready: true, hasKey: true };
});

describe("useTourProse", () => {
  it("asks before anything leaves the machine, then remembers the answer", async () => {
    mocks.aiSummary.mockResolvedValue(answer('{"title":"T","why":"W","lookAt":[]}'));
    const { result } = tour();

    await act(async () => {
      await result.current.explain(steps[1]);
    });

    // Nothing sent: the notice has not been agreed for this project yet.
    expect(mocks.aiSummary).not.toHaveBeenCalled();
    expect(result.current.pending).toBe("main.py");

    await act(async () => {
      await result.current.confirm();
    });

    expect(mocks.aiSummary).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
    expect(isConfirmed("/home/me/pathfinder")).toBe(true);
  });

  it("does not ask again once the project is confirmed", async () => {
    mocks.aiSummary.mockResolvedValue(answer('{"title":"T","why":"W","lookAt":[]}'));
    const { result } = tour();

    await act(async () => {
      await result.current.explain(steps[1]);
    });
    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.explain(steps[0]);
    });

    expect(mocks.aiSummary).toHaveBeenCalledTimes(2);
    expect(result.current.pending).toBeNull();
  });

  it("sends a step that is already stored without asking anything", async () => {
    mocks.aiCached.mockResolvedValue([true, false]);
    mocks.aiSummary.mockResolvedValue(answer('{"title":"Stored","why":"W","lookAt":[]}'));
    const { result } = tour();

    await waitFor(() => expect(result.current.cached(".")).toBe(true));
    await act(async () => {
      await result.current.explain(steps[0]);
    });

    // A stored answer is read from this machine, so there is nothing to disclose.
    expect(result.current.pending).toBeNull();
    expect(mocks.aiSummary).toHaveBeenCalledTimes(1);
    expect(result.current.state["."]).toMatchObject({
      status: "ready",
      prose: { title: "Stored" },
    });
  });

  it("keeps a fabricated id out of the step, and counts it", async () => {
    mocks.aiSummary.mockResolvedValue(
      answer('{"title":"T","why":"W","lookAt":["main.py","ghost.py"]}')
    );
    const { result } = tour();
    window.localStorage.setItem("scalpel.aiConfirmedRoots", JSON.stringify(["/home/me/pathfinder"]));

    await act(async () => {
      await result.current.explain(steps[1]);
    });

    expect(result.current.state["main.py"]).toMatchObject({
      status: "ready",
      prose: { lookAt: ["main.py"], dropped: 1 },
    });
  });

  it("fails one step without touching the others", async () => {
    mocks.aiSummary.mockResolvedValue(answer("I could not read that."));
    const { result } = tour();

    await act(async () => {
      await result.current.explain(steps[1]);
    });
    await act(async () => {
      await result.current.confirm();
    });

    expect(result.current.state["main.py"]).toMatchObject({ status: "error" });
    expect(result.current.state["."]).toBeUndefined();
  });

  it("reports a missing key rather than offering a request", async () => {
    mocks.settings = { provider: "openrouter", model: "some/model", ready: true, hasKey: false };
    const { result } = tour();

    expect(result.current.needsKey).toBe(true);
  });

  it("can be told to stop waiting for the notice", async () => {
    const { result } = tour();

    await act(async () => {
      await result.current.explain(steps[1]);
    });
    act(() => result.current.cancel());

    expect(result.current.pending).toBeNull();
    expect(isConfirmed("/home/me/pathfinder")).toBe(false);
  });
});
