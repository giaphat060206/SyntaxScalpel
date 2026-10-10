import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ProjectFile, ProjectGraph } from "../../shared/types";
import { TourPanel } from "./TourPanel";
import { planTour } from "./plan";

afterEach(cleanup);

function file(id: string, kind: "code" | "doc" = "code"): ProjectFile {
  return {
    id,
    name: id.split("/").pop() ?? id,
    folderId: "",
    kind,
    sizeBytes: 10,
    imports: [],
  };
}

/** A plan built by the real planner, so the panel is tested against real steps. */
function planOf(graph: ProjectGraph) {
  return planTour(graph);
}

function graph(files: ProjectFile[], entry?: string): ProjectGraph {
  return {
    root: ".",
    folders: [{ id: ".", name: "project", depth: 0 }],
    files,
    edges: [],
    truncated: false,
    entry,
  };
}

function show(graph: ProjectGraph, index = 0, onGoTo = vi.fn()) {
  const plan = planOf(graph);
  const onClose = vi.fn();
  render(
    <TourPanel
      plan={plan}
      steps={plan.steps}
      index={index}
      scopePath="/home/me/pathfinder"
      onGoTo={onGoTo}
      onClose={onClose}
    />
  );
  return { onGoTo, onClose, plan };
}

describe("TourPanel", () => {
  // Nothing is mocked in this file: the panel renders a tour from the payload alone,
  // which is the point — a tour exists before any API key does.
  it("lists the steps with their paths and where the reader is", () => {
    show(graph([file("app.py"), file("util.py")], "app.py"));

    expect(screen.getByText(/Tour · pathfinder/)).toBeTruthy();
    expect(screen.getByText("A suggested reading order, not documentation.")).toBeTruthy();
    expect(screen.getByText("1 / 3")).toBeTruthy();
    expect(screen.getByText("app.py")).toBeTruthy();
    expect(screen.getByText("util.py")).toBeTruthy();
    // The step number and the kind share one text node.
    expect(screen.getByText(/1\. Start here/)).toBeTruthy();
    expect(screen.getByText(/2\. Entry point/)).toBeTruthy();
  });

  it("describes a step in the terms the plan knows, not invented prose", () => {
    show(graph([file("app.py"), file("util.py")], "app.py"));

    expect(screen.getByText(/where the program starts/)).toBeTruthy();
    // The orientation step and a file nothing reaches both have no depth, which is
    // the honest answer rather than a made-up number.
    expect(screen.getAllByText(/not reached from the entry/)).toHaveLength(2);
  });

  it("moves with the buttons and stops at the ends", () => {
    const { onGoTo } = show(graph([file("app.py"), file("util.py")], "app.py"));

    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onGoTo).toHaveBeenCalledWith(1);
  });

  it("moves with the arrow keys, because a tour is a sequence", () => {
    const { onGoTo } = show(graph([file("app.py"), file("util.py")], "app.py"), 1);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onGoTo).toHaveBeenCalledWith(2);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onGoTo).toHaveBeenCalledWith(0);
  });

  it("disables Next on the last step", () => {
    show(graph([file("app.py")], "app.py"), 1);

    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
  });

  it("goes straight to a step that was clicked", () => {
    const { onGoTo } = show(graph([file("app.py"), file("util.py")], "app.py"));

    fireEvent.click(screen.getByText("util.py"));
    expect(onGoTo).toHaveBeenCalledWith(2);
  });

  it("says how many files the cap left out, and only when it did", () => {
    const many = [file("app.py"), ...Array.from({ length: 20 }, (_, i) => file(`f${i}.py`))];
    const { unmount } = render(
      <TourPanel
        plan={planOf(graph(many, "app.py"))}
        steps={planOf(graph(many, "app.py")).steps}
        index={0}
        scopePath="/p"
        onGoTo={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/10 more files would not fit in one tour/)).toBeTruthy();
    unmount();

    show(graph([file("app.py")], "app.py"));
    expect(screen.queryByText(/would not fit/)).toBeNull();
  });

  it("says there is nothing to tour when the project has no code", () => {
    show(graph([file("README.md", "doc")]));

    expect(screen.getByText("No code files to tour here.")).toBeTruthy();
    expect(screen.getByText("no steps")).toBeTruthy();
  });

  it("closes on request", () => {
    const { onClose } = show(graph([file("app.py")], "app.py"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Only the shape the panel reads: it takes the prose as a prop, so these tests need
 *  no IPC at all and stay honest about a tour being useful without any. */
function proseFixture(overrides: Record<string, unknown> = {}) {
  return {
    state: {},
    cached: () => false,
    checking: false,
    needsKey: false,
    providerLabel: "OpenRouter",
    pending: null,
    explain: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

function showWithProse(prose: ReturnType<typeof proseFixture>) {
  const plan = planOf(graph([file("app.py")], "app.py"));
  render(
    <TourPanel
      plan={plan}
      steps={plan.steps}
      index={1}
      scopePath="/home/me/pathfinder"
      prose={prose}
      onGoTo={() => {}}
      onClose={() => {}}
    />
  );
  return prose;
}

describe("TourPanel explanations", () => {
  it("asks for the step the reader is on", () => {
    const prose = showWithProse(proseFixture());

    fireEvent.click(screen.getByRole("button", { name: "Explain this step" }));
    expect(prose.explain).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "app.py" }));
  });

  it("says what would leave the machine, and names where it goes", () => {
    const prose = showWithProse(proseFixture({ pending: "app.py" }));

    // Both the notice and its paragraph contain this text, so name the paragraph.
    const notice = screen.getByText(/This sends a digest of/, { selector: "p" });
    expect(notice.textContent).toContain("app.py");
    expect(notice.textContent).toContain("OpenRouter");
    expect(notice.textContent).toContain("It leaves this machine");
    expect(screen.queryByRole("button", { name: "Explain this step" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send to OpenRouter" }));
    expect(prose.confirm).toHaveBeenCalledTimes(1);
  });

  it("shows an explanation with the ids that really exist, and counts the rest", () => {
    showWithProse(
      proseFixture({
        state: {
          "app.py": {
            status: "ready",
            cached: true,
            prose: {
              title: "Entry point",
              why: "Wires the pieces together.",
              lookAt: ["util.py"],
              dropped: 2,
            },
          },
        },
      })
    );

    expect(screen.getByText("Entry point")).toBeTruthy();
    expect(screen.getByText("Wires the pieces together.")).toBeTruthy();
    expect(screen.getByText(/also worth opening: util\.py/)).toBeTruthy();
    expect(screen.getByText(/2 ids it named are not in this project/)).toBeTruthy();
    expect(screen.getByText(/already generated — no request was made/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this step" })).toBeNull();
  });

  it("offers nothing to ask for while a key is missing", () => {
    showWithProse(proseFixture({ needsKey: true }));

    expect(screen.getByText(/No OpenRouter key yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this step" })).toBeNull();
  });

  it("says which provider the tour would send to, so it is never a surprise", () => {
    showWithProse(proseFixture({ providerLabel: "DeepSeek" }));

    // The tour has no provider of its own: it says which one it inherited.
    expect(screen.getByText(/via DeepSeek/)).toBeTruthy();
  });

  it("names the provider whose key is missing, and says where to change it", () => {
    showWithProse(proseFixture({ needsKey: true, providerLabel: "DeepSeek" }));

    expect(screen.getByText(/No DeepSeek key yet/)).toBeTruthy();
    expect(screen.getByText(/pick another provider there/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this step" })).toBeNull();
  });

  it("marks the steps whose answers are already stored", () => {
    // A stored answer is read from this machine, so those steps cost nothing to open.
    // The marker is what tells a reader the tour resumes rather than restarts.
    showWithProse(proseFixture({ cached: () => true }));

    expect(screen.getAllByTitle("already generated").length).toBeGreaterThan(0);
  });

  it("marks nothing when no step has an answer stored", () => {
    showWithProse(proseFixture());

    expect(screen.queryAllByTitle("already generated")).toHaveLength(0);
  });

  it("copies the tour as Markdown, with the order and no prose it does not have", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    showWithProse(proseFixture());

    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const document = writeText.mock.calls[0][0] as string;
    expect(document).toContain("# Tour: /home/me/pathfinder");
    expect(document).toContain("**app.py**");
  });
});
