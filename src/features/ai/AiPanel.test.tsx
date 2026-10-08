import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  aiCached,
  analyzeImports,
  aiSettings,
  aiSummary,
  functionGraph,
  projectGraph,
  setAiKey,
  type AiRequest,
  type AiSummary,
} from "../../shared/ipc";
import type { FunctionGraph, ProjectGraph } from "../../shared/types";
import { AiPanel } from "./AiPanel";
import { cacheLabel } from "./AiResultView";
import { rememberConfirmed } from "./egress";
import { MAX_SCOPE_ROWS } from "./relationships";

vi.mock("../../shared/ipc", () => ({
  aiSettings: vi.fn(),
  setAiKey: vi.fn(),
  clearAiKey: vi.fn(),
  aiSummary: vi.fn(),
  aiCached: vi.fn(async () => []),
  projectGraph: vi.fn(async () => ({
    root: "/project",
    folders: [],
    files: [],
    edges: [],
    truncated: false,
  })),
  analyzeImports: vi.fn(async () => ({ imports: [], importedBy: [] })),
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
  results: Record<string, { request: AiRequest; result: AiSummary }> = {},
  file: string | null = null,
  selectedDefinitionId: string | null = null,
  selectedProjectId: string | null = null
) {
  const onResult = vi.fn();
  const onShow = vi.fn();
  const onHover = vi.fn();
  const onClose = vi.fn();
  const element = (definition: string | null, project: string | null) => (
    <AiPanel
      root="/project"
      scope=""
      file={file}
      selectedDefinitionId={definition}
      selectedProjectId={project}
      results={results}
      onResult={onResult}
      onShow={onShow}
      onHover={onHover}
      onClose={onClose}
    />
  );
  const view = render(element(selectedDefinitionId, selectedProjectId));
  return {
    onResult,
    onShow,
    onHover,
    onClose,
    unmount: view.unmount,
    /** Pick another node in the file graph, as the canvas would report it. */
    select: (id: string | null) => view.rerender(element(id, null)),
    /** Pick another block in the folder graph. */
    selectProject: (id: string | null) => view.rerender(element(selectedDefinitionId, id)),
  };
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

/** Options stay locked until the store has been asked, so a test that clicks one
 *  waits for it to unlock, the same as a user would. */
async function unlocked(button: HTMLButtonElement): Promise<HTMLButtonElement> {
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: false });
  vi.mocked(setAiKey).mockResolvedValue({ provider: "openrouter", hasKey: true });
  vi.mocked(aiSummary).mockResolvedValue(answer);
  // `clearAllMocks` does not undo an implementation, so the graphs are restored
  // here: a test that mocks one cannot leak it into the next.
  vi.mocked(aiCached).mockImplementation(async () => []);
  vi.mocked(projectGraph).mockResolvedValue({
    root: "/project",
    folders: [],
    files: [],
    edges: [],
    truncated: false,
  });
  vi.mocked(analyzeImports).mockResolvedValue({ imports: [], importedBy: [] });
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
        onHover={vi.fn()}
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
        onHover={vi.fn()}
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
    await unlocked(task);

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

    fireEvent.click(await unlocked(task));
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

describe("AiPanel relationships", () => {
  const graph: FunctionGraph = {
    file: {
      filePath: "algorithms/pathfinder.py",
      edges: [],
      nodes: [{ id: "dijkstra", kind: "function", name: "dijkstra", params: [], returns: [] }],
    },
    imports: { imports: [], importedBy: [] },
    externals: [
      {
        path: "utils/helpers.py",
        nodes: [{ id: "utils/helpers.py::push", kind: "function", name: "push", params: [], returns: [] }],
      },
    ],
    crossEdges: [{ source: "dijkstra", target: "utils/helpers.py::push" }],
    residualImports: [],
    residualImportedBy: [],
    truncated: false,
  };
  const connectionRequest: AiRequest = {
    root: "/project",
    target: {
      kind: "connection",
      source: "algorithms/pathfinder.py::dijkstra",
      target: "utils/helpers.py::push",
    },
    task: "relationship",
    provider: "openrouter",
    model: "",
  };

  beforeEach(() => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
    vi.mocked(functionGraph).mockResolvedValue(graph);
  });

  async function pickTheCaller() {
    const view = renderPanel({}, "algorithms/pathfinder.py");
    fireEvent.click(await screen.findByRole("button", { name: "Definitions" }));
    fireEvent.click(await screen.findByLabelText("fn dijkstra"));
    return view;
  }

  it("lists a connection once its end is picked, with no summary in the row", async () => {
    await pickTheCaller();

    expect(await screen.findByText("utils/helpers.py::push")).toBeTruthy();
    expect(screen.getByText("calls")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy();
    expect(screen.queryByText(/It returns a path/)).toBeNull();
  });

  it("asks about the canonical pair, caller first", async () => {
    rememberConfirmed("/project");
    await pickTheCaller();

    fireEvent.click(
      await unlocked((await screen.findByRole("button", { name: "Generate" })) as HTMLButtonElement)
    );

    await waitFor(() =>
      expect(vi.mocked(aiSummary)).toHaveBeenCalledWith(connectionRequest)
    );
  });

  it("shows a connection that is already generated without asking again", async () => {
    const { onShow } = renderPanel(
      {
        "relationship:algorithms/pathfinder.py::dijkstra->utils/helpers.py::push": {
          request: connectionRequest,
          result: { ...answer, task: "relationship" },
        },
      },
      "algorithms/pathfinder.py"
    );
    fireEvent.click(await screen.findByRole("button", { name: "Definitions" }));
    fireEvent.click(await screen.findByLabelText("fn dijkstra"));

    fireEvent.click(
      await unlocked((await screen.findByRole("button", { name: "✓ Show" })) as HTMLButtonElement)
    );

    expect(onShow).toHaveBeenCalledWith(connectionRequest, {
      ...answer,
      task: "relationship",
    });
    expect(vi.mocked(aiSummary)).not.toHaveBeenCalled();
  });

  it("raises and clears the pair a row is hovering", async () => {
    const { onHover } = await pickTheCaller();
    const row = (await screen.findByText("utils/helpers.py::push")).closest("li")!;

    fireEvent.mouseEnter(row);
    expect(onHover).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "algorithms/pathfinder.py::dijkstra",
        target: "utils/helpers.py::push",
        nodes: ["dijkstra", "utils/helpers.py::push"],
      })
    );

    fireEvent.mouseLeave(row);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("follows the definition selected in the graph, both ways round", async () => {
    const view = renderPanel({}, "algorithms/pathfinder.py", "dijkstra");

    // The graph's selection is the subject, so only its own relationship shows.
    expect(await screen.findByText("utils/helpers.py::push")).toBeTruthy();
    expect(screen.getByText("calls")).toBeTruthy();

    view.select("utils/helpers.py::push");

    expect(await screen.findByText("algorithms/pathfinder.py::dijkstra")).toBeTruthy();
    expect(screen.getByText("called by")).toBeTruthy();
  });

  it("ignores a dashed file block, which is not a definition", async () => {
    renderPanel({}, "algorithms/pathfinder.py", "utils/helpers.py");

    expect(await screen.findByText("nothing connected to this yet")).toBeTruthy();
  });

  it("follows a file picked in the folder graph", async () => {
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files: [
        {
          id: "algorithms/pathfinder.py",
          name: "pathfinder.py",
          folderId: "algorithms",
          kind: "code",
          sizeBytes: 0,
          imports: [
            { targetId: "utils/helpers.py", specifier: "utils.helpers", names: ["MinHeap"] },
          ],
        },
        {
          id: "utils/helpers.py",
          name: "helpers.py",
          folderId: "utils",
          kind: "code",
          sizeBytes: 0,
          imports: [],
        },
      ],
      edges: [],
      truncated: false,
    });
    vi.mocked(analyzeImports).mockResolvedValue({
      imports: [],
      importedBy: [{ path: "tests/test_algorithms.py", names: ["PathFinder"] }],
    });

    renderPanel({}, null, null, "algorithms/pathfinder.py");

    // What it imports, and what imports it — the file's own two halves.
    expect(await screen.findByText("utils/helpers.py")).toBeTruthy();
    expect(screen.getByText("tests/test_algorithms.py")).toBeTruthy();
    expect(screen.getByText("imports")).toBeTruthy();
    expect(screen.getByText("imported by")).toBeTruthy();
  });

  it("follows a folder picked in the folder graph", async () => {
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files: ["algorithms/pathfinder.py", "utils/helpers.py"].map((id) => ({
        id,
        name: id.split("/")[1],
        folderId: id.split("/")[0],
        kind: "code" as const,
        sizeBytes: 0,
        imports: [],
      })),
      edges: [{ source: "algorithms/pathfinder.py", target: "utils/helpers.py" }],
      truncated: false,
    });

    renderPanel({}, null, null, "algorithms");

    expect(
      await screen.findByText("algorithms/pathfinder.py -> utils/helpers.py")
    ).toBeTruthy();
  });
});

describe("AiPanel marks from the store", () => {
  beforeEach(() => {
    vi.mocked(aiSettings).mockResolvedValue({ provider: "openrouter", hasKey: true });
  });

  it("lets a long import label wrap rather than cutting the file name off", async () => {
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files: [
        {
          id: "tests/test_algorithms.py",
          name: "test_algorithms.py",
          folderId: "tests",
          kind: "code",
          sizeBytes: 0,
          imports: [],
        },
        {
          id: "algorithms/pathfinder.py",
          name: "pathfinder.py",
          folderId: "algorithms",
          kind: "code",
          sizeBytes: 0,
          imports: [],
        },
      ],
      edges: [{ source: "tests/test_algorithms.py", target: "algorithms/pathfinder.py" }],
      truncated: false,
    });

    renderPanel();

    const labels = await screen.findAllByText(
      "tests/test_algorithms.py -> algorithms/pathfinder.py"
    );

    // Both ends of one edge, so the receiving file is named as well as the
    // importing one.
    expect(labels).toHaveLength(2);
    expect(screen.getByText("imports")).toBeTruthy();
    expect(screen.getByText("imported by")).toBeTruthy();

    const label = labels[0];
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("break-all");

    // A `//` or `/*` comment written among JSX children is not a comment: it is
    // text, and it renders. Nothing else would notice.
    const row = label.closest("li") as HTMLElement;
    expect(row.textContent ?? "").not.toMatch(/\/\/|\/\*/);
    expect(screen.getByText("imported by").className).not.toBe(
      screen.getByText("imports").className
    );
  });

  it("says when the scope listing was cut short instead of hiding the rest", async () => {
    const files: ProjectGraph["files"] = Array.from(
      { length: MAX_SCOPE_ROWS + 5 },
      (_, index) => ({
        id: `f${index}.py`,
        name: `f${index}.py`,
        folderId: "",
        kind: "code" as const,
        sizeBytes: 0,
        imports: [],
      })
    );
    files.push({
      id: "outside.py",
      name: "outside.py",
      folderId: "",
      kind: "code" as const,
      sizeBytes: 0,
      imports: [],
      external: true,
    });
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files,
      edges: files
        .filter((file) => !file.external)
        .map((file) => ({ source: file.id, target: "outside.py" })),
      truncated: false,
    });

    renderPanel();

    expect(
      await screen.findByText(
        new RegExp(`showing ${MAX_SCOPE_ROWS} of ${MAX_SCOPE_ROWS + 5}`)
      )
    ).toBeTruthy();
  });

  it("puts what imports the file above what the file imports", async () => {
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files: ["tests/test_algorithms.py", "algorithms/pathfinder.py"].map((id) => ({
        id,
        name: id.split("/")[1],
        folderId: id.split("/")[0],
        kind: "code" as const,
        sizeBytes: 0,
        imports: [],
      })),
      edges: [{ source: "tests/test_algorithms.py", target: "algorithms/pathfinder.py" }],
      truncated: false,
    });

    renderPanel();

    const list = (await screen.findByText("imported by")).closest("ul") as HTMLElement;
    const rows = [...list.querySelectorAll("li")].map((row) => row.textContent ?? "");

    expect(rows[0]).toContain("imported by");
    expect(rows[1]).toContain("imports");
  });

  it("lists a scope's own imports, which is all a self-contained project has", async () => {
    vi.mocked(projectGraph).mockResolvedValue({
      root: "/project",
      folders: [],
      files: [
        {
          id: "algorithms/pathfinder.py",
          name: "pathfinder.py",
          folderId: "algorithms",
          kind: "code",
          sizeBytes: 0,
          imports: [],
        },
        {
          id: "core/path.py",
          name: "path.py",
          folderId: "core",
          kind: "code",
          sizeBytes: 0,
          imports: [],
        },
      ],
      edges: [{ source: "algorithms/pathfinder.py", target: "core/path.py" }],
      truncated: false,
    });

    renderPanel();

    expect(
      await screen.findAllByText("algorithms/pathfinder.py -> core/path.py")
    ).toHaveLength(2);
  });

  it("asks for a definition before claiming there is nothing to show", async () => {
    renderPanel({}, "algorithms/pathfinder.py");
    fireEvent.click(await screen.findByRole("button", { name: "Definitions" }));

    expect(await screen.findByText(/pick a definition/)).toBeTruthy();
  });

  it("marks a task the store can answer with no session history at all", async () => {
    vi.mocked(aiCached).mockImplementation(async (_root, requests) =>
      requests.map((request) => request.task === "project-overview")
    );

    renderPanel();

    const button = await screen.findByRole("button", { name: /Project overview/ });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(
      screen.getByRole("button", { name: /Report impact/ }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("shows a stored answer with no egress notice, because nothing leaves", async () => {
    vi.mocked(aiCached).mockImplementation(async (_root, requests) =>
      requests.map(() => true)
    );
    vi.mocked(aiSummary).mockResolvedValue({ ...answer, task: "project-overview" });
    const { onResult } = renderPanel();
    const button = await screen.findByRole("button", { name: /Project overview/ });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));

    fireEvent.click(button);

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(screen.queryByText(/leaves this machine/)).toBeNull();
  });

  it("says it is asking while the probe is in flight, then stops", async () => {
    const resolvers: ((found: boolean[]) => void)[] = [];
    vi.mocked(aiCached).mockImplementation(
      () =>
        new Promise<boolean[]>((resolve) => {
          resolvers.push(resolve);
        })
    );

    renderPanel();

    expect(await screen.findByText(/asking the store/)).toBeTruthy();

    resolvers.forEach((resolve) => resolve([]));

    await waitFor(() => expect(screen.queryByText(/asking the store/)).toBeNull());
  });

  it("locks every option again whenever the question moves, until the store answers", async () => {
    const resolvers: ((found: boolean[]) => void)[] = [];
    vi.mocked(aiCached).mockImplementation(
      () =>
        new Promise<boolean[]>((resolve) => {
          resolvers.push(resolve);
        })
    );

    renderPanel();
    const locked = await findTask(/Explain selection/);

    // Let the first round finish, so nothing but a fresh probe can lock it.
    await waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
    resolvers.splice(0).forEach((resolve) => resolve([]));
    await waitFor(() => expect(locked.disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "deepseek-reasoner" },
    });

    await waitFor(() => expect(locked.disabled).toBe(true));
    expect((await findTask(/Project overview/)).disabled).toBe(true);

    await waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
    resolvers.splice(0).forEach((resolve) => resolve([]));

    await waitFor(() => expect(locked.disabled).toBe(false));
  });

  it("marks an option as soon as its own answer lands, without waiting for the rest", async () => {
    const resolvers: ((found: boolean[]) => void)[] = [];
    vi.mocked(aiCached).mockImplementation(
      (_root, requests) =>
        new Promise<boolean[]>((resolve) => {
          // The first option answers at once; the rest stay in flight.
          if (requests[0].task === "explain-selection") {
            resolve([true]);
          } else {
            resolvers.push(resolve);
          }
        })
    );

    renderPanel();

    const button = await screen.findByRole("button", { name: /Explain selection/ });
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByText(/asking the store/)).toBeTruthy();

    resolvers.forEach((resolve) => resolve([]));

    await waitFor(() => expect(screen.queryByText(/asking the store/)).toBeNull());
  });

  it("marks a relationship row the store can answer", async () => {
    vi.mocked(aiCached).mockImplementation(async (_root, requests) =>
      requests.map((request) => request.task === "relationship")
    );
    vi.mocked(functionGraph).mockResolvedValue({
      file: {
        filePath: "algorithms/pathfinder.py",
        edges: [],
        nodes: [{ id: "dijkstra", kind: "function", name: "dijkstra", params: [], returns: [] }],
      },
      imports: { imports: [], importedBy: [] },
      externals: [
        {
          path: "utils/helpers.py",
          nodes: [{ id: "utils/helpers.py::push", kind: "function", name: "push", params: [], returns: [] }],
        },
      ],
      crossEdges: [{ source: "dijkstra", target: "utils/helpers.py::push" }],
      residualImports: [],
      residualImportedBy: [],
      truncated: false,
    });

    renderPanel({}, "algorithms/pathfinder.py");
    fireEvent.click(await screen.findByRole("button", { name: "Definitions" }));
    fireEvent.click(await screen.findByLabelText("fn dijkstra"));

    expect(await screen.findByRole("button", { name: "✓ Show" })).toBeTruthy();
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
