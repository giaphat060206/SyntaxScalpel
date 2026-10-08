import { describe, it, expect } from "vitest";
import type { TourStep } from "./plan";
import { tourMarkdown } from "./markdown";
import type { TourProseState } from "./useTourProse";

const steps: TourStep[] = [
  { nodeId: ".", kind: "orientation", alsoIds: [], depth: null, dependents: 0 },
  { nodeId: "src/main.py", kind: "entry", alsoIds: ["src"], depth: 0, dependents: 1 },
];

describe("tourMarkdown", () => {
  it("writes the order with the real paths", () => {
    const document = tourMarkdown({
      plan: { steps, dropped: 0, truncated: false },
      steps,
      prose: {},
      scopePath: "/home/me/pathfinder",
    });

    expect(document).toContain("# Tour: /home/me/pathfinder");
    expect(document).toContain("A suggested reading order, not documentation.");
    // The orientation step's id is the scope id, so the document names the folder.
    expect(document).toContain("1. **/home/me/pathfinder** — not reached from the entry");
    expect(document).toContain("2. **src/main.py** — where the program starts · 1 file imports this");
  });

  it("includes an explanation when there is one, and says nothing when there is not", () => {
    const prose: Record<string, TourProseState> = {
      "src/main.py": {
        status: "ready",
        cached: false,
        prose: { title: "Entry point", why: "Wires everything up.", lookAt: ["src/parse.py"], dropped: 0 },
      },
    };

    const document = tourMarkdown({
      plan: { steps, dropped: 0, truncated: false },
      steps,
      prose,
      scopePath: "/p",
    });

    expect(document).toContain("- Entry point");
    expect(document).toContain("Wires everything up.");
    expect(document).toContain("- also worth opening: src/parse.py");
    // The orientation step was never explained, so it carries no prose at all.
    expect(document).not.toContain("asking");
  });

  it("says when the cap left files out", () => {
    const document = tourMarkdown({
      plan: { steps, dropped: 9, truncated: true },
      steps,
      prose: {},
      scopePath: "/p",
    });

    expect(document).toContain("> 9 more files would not fit in one tour.");
  });

  it("copes with no plan at all, which is a project with nothing to tour", () => {
    const document = tourMarkdown({ plan: null, steps: [], prose: {}, scopePath: "/p" });

    expect(document).toContain("# Tour: /p");
    expect(document).not.toContain("1.");
  });
});
