import { describe, it, expect } from "vitest";
import type { ProjectFile, ProjectGraph } from "../../shared/types";
import { MAX_TOUR_STEPS, planTour } from "./plan";

function file(id: string, folderId = "", kind: "code" | "doc" = "code", external = false): ProjectFile {
  return {
    id,
    name: id.split("/").pop() ?? id,
    folderId,
    kind,
    sizeBytes: 100,
    imports: [],
    external,
  };
}

function graph(
  files: ProjectFile[],
  edges: Array<[string, string]> = [],
  overrides: Partial<ProjectGraph> = {}
): ProjectGraph {
  return {
    // The payload's root is the scope id: "." for the whole project.
    root: ".",
    folders: [{ id: ".", name: "project", depth: 0 }],
    files,
    edges: edges.map(([source, target]) => ({ source, target })),
    truncated: false,
    ...overrides,
  };
}

describe("planTour", () => {
  it("starts at the scope folder and then at the entry point", () => {
    const plan = planTour(
      graph([file("app.py"), file("util.py")], [["app.py", "util.py"]], { entry: "app.py" })
    );

    expect(plan.steps[0]).toMatchObject({ nodeId: ".", kind: "orientation", depth: null });
    expect(plan.steps[1]).toMatchObject({ nodeId: "app.py", kind: "entry", depth: 0 });
  });

  it("orders the rest outward from the entry, and the most depended on first", () => {
    // near.py is one hop away with one dependent; hub.py is two hops away with two.
    // Distance wins, so near.py comes first even though fewer files import it.
    const plan = planTour(
      graph(
        [file("app.py"), file("near.py"), file("far.py"), file("hub.py"), file("other.py")],
        [
          ["app.py", "near.py"],
          ["near.py", "far.py"],
          ["hub.py", "far.py"],
          ["other.py", "far.py"],
        ],
        { entry: "app.py" }
      )
    );

    expect(plan.steps.map((step) => step.nodeId)).toEqual([
      ".",
      "app.py",
      "near.py",
      "far.py",
      "hub.py",
      "other.py",
    ]);
    expect(plan.steps[3]).toMatchObject({ nodeId: "far.py", depth: 2, dependents: 3 });
  });

  it("breaks ties by path, so a plan cannot reshuffle between runs", () => {
    const plan = planTour(
      graph([file("app.py"), file("zeta.py"), file("alpha.py")], [], { entry: "app.py" })
    );

    // Neither is reachable and neither is imported, so only the path decides.
    expect(plan.steps.map((step) => step.nodeId)).toEqual([".", "app.py", "alpha.py", "zeta.py"]);
  });

  it("caps the steps and says how many it left out", () => {
    const files = [file("app.py"), ...Array.from({ length: 20 }, (_, i) => file(`f${i}.py`))];
    const plan = planTour(graph(files, [], { entry: "app.py" }));

    expect(plan.steps).toHaveLength(MAX_TOUR_STEPS);
    expect(plan.dropped).toBe(20 - (MAX_TOUR_STEPS - 2));
    expect(plan.truncated).toBe(true);
  });

  it("does not claim to have dropped anything when everything fits", () => {
    const plan = planTour(graph([file("a.py"), file("b.py")], [], { entry: "a.py" }));

    expect(plan.dropped).toBe(0);
    expect(plan.truncated).toBe(false);
  });

  it("leaves external files and docs out of the tour", () => {
    const plan = planTour(
      graph(
        [
          file("app.py"),
          file("README.md", "", "doc"),
          file("vendor/lib.py", "", "code", true),
        ],
        [],
        { entry: "app.py" }
      )
    );

    expect(plan.steps.map((step) => step.nodeId)).toEqual([".", "app.py"]);
  });

  it("carries the folder a step's file lives in, so both can be highlighted", () => {
    const plan = planTour(
      graph(
        [file("app.py"), file("src/parser/thing.py", "src/parser")],
        [["app.py", "src/parser/thing.py"]],
        {
          entry: "app.py",
          folders: [
            { id: ".", name: "project", depth: 0 },
            { id: "src", name: "src", parentId: ".", depth: 1 },
            { id: "src/parser", name: "parser", parentId: "src", depth: 2 },
          ],
        }
      )
    );

    const step = plan.steps.find((candidate) => candidate.nodeId === "src/parser/thing.py");
    expect(step?.alsoIds).toEqual(["src/parser"]);
    // The orientation step is the folder itself: nothing to highlight beside it.
    expect(plan.steps[0].alsoIds).toEqual([]);
  });

  it("still plans when no entry point was detected", () => {
    const plan = planTour(
      graph([file("a.py"), file("b.py"), file("c.py")], [["a.py", "c.py"], ["b.py", "c.py"]])
    );

    expect(plan.steps.map((step) => step.kind)).toEqual(["orientation", "module", "module", "module"]);
    // c.py is imported by two files, so it leads a tour with no entry to start from.
    expect(plan.steps[1]).toMatchObject({ nodeId: "c.py", dependents: 2, depth: null });
  });

  it("puts a file nothing reaches last, even if it imports a lot", () => {
    const plan = planTour(
      graph(
        [file("app.py"), file("reachable.py"), file("island.py"), file("elsewhere.py")],
        [["app.py", "reachable.py"], ["island.py", "elsewhere.py"]],
        { entry: "app.py" }
      )
    );

    // island.py and elsewhere.py are unreachable from the entry, so they come after.
    expect(plan.steps.map((step) => step.nodeId)).toEqual([
      ".",
      "app.py",
      "reachable.py",
      "elsewhere.py",
      "island.py",
    ]);
    expect(plan.steps[3].depth).toBeNull();
  });

  it("plans a scoped payload the same way, staying inside the scope", () => {
    const plan = planTour(
      graph(
        [file("src/app.py", "src"), file("src/util.py", "src")],
        [["src/app.py", "src/util.py"]],
        {
          root: "src",
          folders: [{ id: "src", name: "src", depth: 0 }],
          entry: "src/app.py",
        }
      )
    );

    expect(plan.steps[0]).toMatchObject({ nodeId: "src", kind: "orientation" });
    expect(plan.steps.map((step) => step.nodeId)).toEqual(["src", "src/app.py", "src/util.py"]);
  });

  it("still gives a usable first step when the payload's root is not a node", () => {
    const plan = planTour(
      graph([file("app.py")], [], {
        root: "gone",
        folders: [{ id: ".", name: "project", depth: 0 }],
        entry: "app.py",
      })
    );

    expect(plan.steps[0].nodeId).toBe(".");
  });
});
