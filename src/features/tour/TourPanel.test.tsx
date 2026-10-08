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
