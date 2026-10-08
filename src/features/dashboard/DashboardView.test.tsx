import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ProjectFile, ProjectGraph } from "../../shared/types";
import { DashboardView } from "./DashboardView";

// The vitest config sets no `globals`, so Testing Library's automatic cleanup
// never registers and DOM from one test would still be there in the next.
afterEach(cleanup);

function file(
  id: string,
  kind: "code" | "doc",
  sizeBytes: number,
  external = false
): ProjectFile {
  return {
    id,
    name: id.split("/").pop() ?? id,
    folderId: "",
    kind,
    sizeBytes,
    imports: [],
    external,
  };
}

function project(
  files: ProjectFile[],
  overrides: Partial<ProjectGraph> = {}
): ProjectGraph {
  return {
    root: "/home/me/pathfinder",
    folders: [],
    files,
    edges: [],
    truncated: false,
    ...overrides,
  };
}

function show(graph: ProjectGraph) {
  const onOpenGraph = vi.fn();
  const onOpenAi = vi.fn();
  render(
    <DashboardView state={{ status: "ready", value: graph }} onOpenGraph={onOpenGraph} onOpenAi={onOpenAi} />
  );
  return { onOpenGraph, onOpenAi };
}

describe("DashboardView", () => {
  it("says it is reading the project before the payload arrives", () => {
    render(
      <DashboardView state={{ status: "loading" }} onOpenGraph={() => {}} onOpenAi={() => {}} />
    );

    expect(screen.getByText(/reading the project/)).toBeTruthy();
  });

  it("shows the load error instead of a dashboard", () => {
    render(
      <DashboardView
        state={{ status: "error", message: "permission denied" }}
        onOpenGraph={() => {}}
        onOpenAi={() => {}}
      />
    );

    expect(screen.getByText("permission denied")).toBeTruthy();
  });

  it("names the project and counts what is in it", () => {
    show(
      project([file("a.py", "code", 100), file("b.ts", "code", 300), file("r.md", "doc", 12)], {
        folders: Array.from({ length: 5 }, (_, index) => ({
          id: `f${index}`,
          name: `f${index}`,
          depth: 0,
        })),
        edges: Array.from({ length: 7 }, (_, index) => ({
          source: `a${index}.py`,
          target: "b.ts",
        })),
      })
    );

    expect(screen.getByRole("heading", { name: "pathfinder" })).toBeTruthy();
    // Every number in the totals is distinct, so each assertion names one cell.
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("412 B")).toBeTruthy();
  });

  it("labels the donut with each language's share of the bytes", () => {
    show(project([file("a.py", "code", 750), file("b.ts", "code", 250)]));

    expect(
      screen.getByRole("img", {
        name: /^Language ratio by bytes \(code files\): Python 75%, TypeScript 25%$/,
      })
    ).toBeTruthy();
  });

  it("leaves doc files out of the ratio and says what they weigh", () => {
    show(project([file("main.py", "code", 1000), file("README.md", "doc", 500)]));

    // Python is the whole ratio: a README is not a language the project is written in.
    expect(
      screen.getByRole("img", {
        name: /^Language ratio by bytes \(code files\): Python 100%$/,
      })
    ).toBeTruthy();
    expect(screen.queryByText("Markdown")).toBeNull();
    // And it is not offered as one of the largest files either.
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.getByText(/Code files only — 1 doc file \(500 B\) left out/)).toBeTruthy();
    // The project's own size still counts it.
    expect(screen.getByText("1.5 KB")).toBeTruthy();
  });

  it("says when the scan was cut short, and stays quiet when it was not", () => {
    const { unmount } = render(
      <DashboardView
        state={{ status: "ready", value: project([file("a.py", "code", 1)], { truncated: true }) }}
        onOpenGraph={() => {}}
        onOpenAi={() => {}}
      />
    );
    expect(screen.getByText(/larger than one scan/)).toBeTruthy();
    unmount();

    show(project([file("a.py", "code", 1)]));
    expect(screen.queryByText(/larger than one scan/)).toBeNull();
  });

  it("falls back to file counts when the project measures no bytes at all", () => {
    show(project([file("a.py", "code", 0), file("b.ts", "code", 0)]));

    expect(
      screen.getByRole("img", { name: /^Language ratio by file count \(code files\):/ })
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Languages by file count" })).toBeTruthy();
  });

  it("leaves imported files out of the numbers and says how many there were", () => {
    show(
      project([
        file("a.py", "code", 100),
        file("b.ts", "code", 24),
        file("vendor/lib.py", "code", 9999, true),
      ])
    );

    expect(screen.getByText(/1 imported file outside/)).toBeTruthy();
    // 124 B: the two in-scope files, not 10123 B with the imported one. Two
    // languages, so the total is not the same string as either legend row.
    expect(screen.getByText("124 B")).toBeTruthy();
  });

  it("lists entry points in its own section, and says when there are none", () => {
    const { unmount } = render(
      <DashboardView
        state={{
          status: "ready",
          value: project([file("main.py", "code", 4)], { entry: "main.py" }),
        }}
        onOpenGraph={() => {}}
        onOpenAi={() => {}}
      />
    );
    const entries = screen.getByRole("heading", { name: "Entry points" }).parentElement as HTMLElement;
    expect(within(entries).getByText("main.py")).toBeTruthy();
    unmount();

    show(project([file("a.py", "code", 4)]));
    expect(screen.getByText("None detected.")).toBeTruthy();
  });

  it("opens the graph and the AI panel from its own buttons", () => {
    const { onOpenGraph, onOpenAi } = show(project([file("a.py", "code", 4)]));

    fireEvent.click(screen.getByRole("button", { name: "View graph" }));
    fireEvent.click(screen.getByRole("button", { name: "Summarise this project" }));

    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    expect(onOpenAi).toHaveBeenCalledTimes(1);
  });
});
