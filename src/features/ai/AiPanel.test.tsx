import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { aiSettings, aiSummary, setAiKey } from "../../shared/ipc";
import { AiPanel } from "./AiPanel";
import { cacheLabel } from "./AiResultView";

vi.mock("../../shared/ipc", () => ({
  aiSettings: vi.fn(),
  setAiKey: vi.fn(),
  clearAiKey: vi.fn(),
  aiSummary: vi.fn(),
}));

const answer = {
  text: "It returns a path.",
  task: "explain-selection",
  provider: "openrouter",
  model: "m",
  cached: false,
  truncated: false,
  createdAtMs: 1_000_000,
  inputTokens: 10,
  outputTokens: 5,
};

function renderPanel() {
  const onResult = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <AiPanel
      root="/project"
      target={{ kind: "scope", scope: "" }}
      onResult={onResult}
      onClose={onClose}
    />
  );
  return { onResult, onClose, unmount: view.unmount };
}

function taskButton(name: RegExp): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function findTask(name: RegExp): Promise<HTMLButtonElement> {
  return (await screen.findByRole("button", { name })) as HTMLButtonElement;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: false });
  vi.mocked(setAiKey).mockResolvedValue({ provider: "openrouter", hasKey: true });
  vi.mocked(aiSummary).mockResolvedValue(answer);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiPanel gating", () => {
  it("greys out every task until a key exists, and still offers the key field", async () => {
    renderPanel();
    const task = await findTask(/Explain selection/);

    await waitFor(() => expect(task.disabled).toBe(true));
    expect(task.getAttribute("title")).toBe("Add an API key");
    expect(taskButton(/Project overview/).disabled).toBe(true);
    expect(taskButton(/Check documentation/).disabled).toBe(true);
    expect((screen.getByLabelText("API key") as HTMLInputElement).disabled).toBe(false);
  });

  it("enables the tasks when a key is held", async () => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
    renderPanel();
    const task = await findTask(/Explain selection/);

    await waitFor(() => expect(task.disabled).toBe(false));
    expect(task.getAttribute("title")).toContain("What the chosen code does");
  });

  it("clears the gate once a key is saved", async () => {
    renderPanel();
    const task = await findTask(/Explain selection/);
    await waitFor(() => expect(task.disabled).toBe(true));

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(vi.mocked(setAiKey)).toHaveBeenCalledWith("openrouter", "sk-1"));
    await waitFor(() => expect(task.disabled).toBe(false));
  });
});

describe("AiPanel running a task", () => {
  beforeEach(() => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
  });

  it("asks with the chosen task and hands the answer back", async () => {
    const { onResult } = renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(vi.mocked(aiSummary)).toHaveBeenCalledWith({
      root: "/project",
      target: { kind: "scope", scope: "" },
      task: "project-overview",
      provider: "openrouter",
      model: "",
    });
    expect(onResult.mock.calls[0][1]).toEqual(answer);
  });

  it("shows what the provider said when it fails", async () => {
    vi.mocked(aiSummary).mockRejectedValue(new Error("the provider refused the key"));
    renderPanel();
    const task = await findTask(/Report impact/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);

    await screen.findByText(/refused the key/);
  });

  it("asks nothing when there is no target yet", async () => {
    render(
      <AiPanel root="/project" target={null} onResult={vi.fn()} onClose={vi.fn()} />
    );
    const task = await findTask(/Explain selection/);

    await waitFor(() => expect(task.disabled).toBe(true));
    expect(task.getAttribute("title")).toContain("pick what to explain");
  });
});

describe("AiPanel preferences", () => {
  it("remembers the provider and model across a remount", async () => {
    const first = renderPanel();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "some/model" } });
    first.unmount();

    renderPanel();

    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("some/model");
    expect(vi.mocked(aiSettings)).toHaveBeenCalledWith("openrouter");
  });
});

describe("cacheLabel", () => {
  const cached = { ...answer, cached: true, inputTokens: 800, outputTokens: 200 };

  it("says cached, which model, how long ago, and what it cost", () => {
    const label = cacheLabel(cached, 1_000_000 + 2 * 60_000);

    expect(label).toContain("cached · m · 2 min ago");
    expect(label).toContain("1000 tokens");
  });

  it("says fresh for an answer just generated", () => {
    expect(cacheLabel({ ...cached, cached: false }, 1_000_000)).toContain("fresh · m · just now");
  });

  it("counts hours and days", () => {
    expect(cacheLabel(cached, 1_000_000 + 3 * 60 * 60_000)).toContain("3 h ago");
    expect(cacheLabel(cached, 1_000_000 + 3 * 24 * 60 * 60_000)).toContain("3 d ago");
  });

  it("says when the digest was truncated", () => {
    expect(cacheLabel({ ...cached, truncated: true }, 1_000_000)).toContain("digest truncated");
  });
});
