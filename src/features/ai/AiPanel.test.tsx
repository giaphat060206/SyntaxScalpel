import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { aiSettings, aiSummary, setAiKey, type AiRequest, type AiSummary } from "../../shared/ipc";
import { AiPanel } from "./AiPanel";
import { cacheLabel } from "./AiResultView";
import { rememberConfirmed } from "./egress";

vi.mock("../../shared/ipc", () => ({
  aiSettings: vi.fn(),
  setAiKey: vi.fn(),
  clearAiKey: vi.fn(),
  aiSummary: vi.fn(),
  projectGraph: vi.fn(async () => ({
    root: "/project",
    folders: [],
    files: [],
    edges: [],
    truncated: false,
  })),
  functionGraph: vi.fn(),
}));

const answer = {
  key: "a".repeat(64),
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

function renderPanel(
  results: Record<string, { request: AiRequest; result: AiSummary }> = {}
) {
  const onResult = vi.fn();
  const onShow = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <AiPanel
      root="/project"
      scope=""
      file={null}
      results={results}
      onResult={onResult}
      onShow={onShow}
      onClose={onClose}
    />
  );
  return { onResult, onShow, onClose, unmount: view.unmount };
}

const scopeRequest: AiRequest = {
  root: "/project",
  target: { kind: "scope", scope: "" },
  task: "project-overview",
  provider: "openrouter",
  model: "",
};

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

  it("asks with the chosen task and hands the answer back, once egress is agreed", async () => {
    const { onResult } = renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);
    fireEvent.click(await screen.findByRole("button", { name: /Send to OpenRouter/ }));

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
    fireEvent.click(await screen.findByRole("button", { name: /Send to OpenRouter/ }));

    await screen.findByText(/refused the key/);
    expect(screen.queryByText(/leaves this machine/)).toBeNull();
  });

  it("asks nothing and says why when no folder is open", async () => {
    render(
      <AiPanel
        root={null}
        scope=""
        file={null}
        results={{}}
        onResult={vi.fn()}
        onShow={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const task = await findTask(/Explain selection/);

    await waitFor(() => expect(task.disabled).toBe(true));
    expect(task.getAttribute("title")).toBe("Open a folder first");
  });

  it("sends the whole scope until a narrower target is chosen", async () => {
    const { onResult } = renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    await waitFor(() => expect(task.disabled).toBe(true));
    expect(task.getAttribute("title")).toBe("Pick at least one file");

    fireEvent.click(task);
    expect(onResult).not.toHaveBeenCalled();
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

describe("AiPanel egress", () => {
  beforeEach(() => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
  });

  it("names the provider and asks before the first summary for a project", async () => {
    renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);

    const notice = await screen.findByText(/leaves this machine/);
    expect(notice.textContent).toContain("OpenRouter");
    expect(vi.mocked(aiSummary)).not.toHaveBeenCalled();
  });

  it("asks nothing when the notice is cancelled", async () => {
    renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/leaves this machine/)).toBeNull();
    expect(vi.mocked(aiSummary)).not.toHaveBeenCalled();
  });

  it("does not ask again for a project already agreed to", async () => {
    const first = renderPanel();
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));
    fireEvent.click(task);
    fireEvent.click(await screen.findByRole("button", { name: /Send to OpenRouter/ }));
    await waitFor(() => expect(vi.mocked(aiSummary)).toHaveBeenCalledTimes(1));
    first.unmount();

    renderPanel();
    const again = await findTask(/Report impact/);
    await waitFor(() => expect(again.disabled).toBe(false));
    fireEvent.click(again);

    await waitFor(() => expect(vi.mocked(aiSummary)).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/leaves this machine/)).toBeNull();
  });

  it("asks again for a different project", async () => {
    rememberConfirmed("/project");
    render(
      <AiPanel
        root="/other"
        scope=""
        file={null}
        results={{}}
        onResult={vi.fn()}
        onShow={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const task = await findTask(/Project overview/);
    await waitFor(() => expect(task.disabled).toBe(false));

    fireEvent.click(task);

    await screen.findByText(/leaves this machine/);
    expect(vi.mocked(aiSummary)).not.toHaveBeenCalled();
  });
});

describe("AiPanel remembering what is done", () => {
  beforeEach(() => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
  });

  it("leaves a task unmarked until it has an answer", async () => {
    renderPanel();
    const task = await findTask(/Project overview/);

    expect(task.getAttribute("aria-pressed")).toBe("false");
    expect(task.textContent).not.toContain("✓");
  });

  it("marks the task done and shows it again without asking anyone", async () => {
    const { onShow } = renderPanel({
      "project-overview": { request: scopeRequest, result: answer },
    });
    const task = await findTask(/Project overview/);

    expect(task.getAttribute("aria-pressed")).toBe("true");
    expect(task.textContent).toContain("✓");
    expect(task.getAttribute("title")).toContain("show it again");

    fireEvent.click(task);

    expect(onShow).toHaveBeenCalledWith(scopeRequest, answer);
    expect(vi.mocked(aiSummary)).not.toHaveBeenCalled();
  });

  it("marks nothing done once the question changes", async () => {
    renderPanel({
      "project-overview": {
        request: { ...scopeRequest, model: "some/other-model" },
        result: answer,
      },
    });
    const task = await findTask(/Project overview/);

    expect(task.getAttribute("aria-pressed")).toBe("false");
  });

  it("still generates when the stored answer was for other code", async () => {
    const { onResult } = renderPanel({
      "project-overview": {
        request: {
          ...scopeRequest,
          target: { kind: "files", scope: "", files: ["other.py"] },
        },
        result: answer,
      },
    });
    const task = await findTask(/Project overview/);
    expect(task.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(task);
    fireEvent.click(await screen.findByRole("button", { name: /Send to OpenRouter/ }));

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(vi.mocked(aiSummary)).toHaveBeenCalledTimes(1);
  });

  it("holds only the task that matches, not its neighbours", async () => {
    renderPanel({ "project-overview": { request: scopeRequest, result: answer } });

    expect((await findTask(/Project overview/)).getAttribute("aria-pressed")).toBe("true");
    expect((await findTask(/Report impact/)).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("cacheLabel", () => {
  const cached = { ...answer, cached: true, inputTokens: 800, outputTokens: 200 };

  it("says cached, which provider and model, how long ago, and what it cost", () => {
    const label = cacheLabel(cached, 1_000_000 + 2 * 60_000);

    expect(label).toContain("cached · openrouter · m · 2 min ago");
    expect(label).toContain("1000 tokens");
  });

  it("says fresh for an answer just generated", () => {
    expect(cacheLabel({ ...cached, cached: false }, 1_000_000)).toContain(
      "fresh · openrouter · m · just now"
    );
  });

  it("counts hours and days", () => {
    expect(cacheLabel(cached, 1_000_000 + 3 * 60 * 60_000)).toContain("3 h ago");
    expect(cacheLabel(cached, 1_000_000 + 3 * 24 * 60 * 60_000)).toContain("3 d ago");
  });

  it("says when the digest was truncated", () => {
    expect(cacheLabel({ ...cached, truncated: true }, 1_000_000)).toContain("digest truncated");
  });
});
