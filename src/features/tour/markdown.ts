import type { TourPlan, TourStep } from "./plan";
import type { TourProseState } from "./useTourProse";

/** What this stop is, in the terms the plan knows. Kept here as well as in the panel
 *  because the document has to say the same thing the panel says. */
function describe(step: TourStep): string {
  const parts = [
    step.depth === null
      ? "not reached from the entry"
      : step.depth === 0
        ? "where the program starts"
        : `${step.depth} hop${step.depth === 1 ? "" : "s"} from the entry`,
  ];
  if (step.dependents > 0) {
    parts.push(
      `${step.dependents} file${step.dependents === 1 ? "" : "s"} import${
        step.dependents === 1 ? "s" : ""
      } this`
    );
  }
  return parts.join(" · ");
}

/**
 * The tour as a document a team can keep: the order, the real paths, and whatever
 * explanations exist. Step prose that was never asked for is simply absent — the
 * document is as good as what the reader paid for, and says nothing it cannot show.
 */
export function tourMarkdown(input: {
  plan: TourPlan | null;
  steps: TourStep[];
  prose: Record<string, TourProseState>;
  scopePath: string;
}): string {
  const { plan, steps, prose, scopePath } = input;
  const lines = [
    `# Tour: ${scopePath}`,
    "",
    "A suggested reading order, not documentation.",
    "",
  ];

  if (plan?.truncated) {
    lines.push(
      `> ${plan.dropped} more file${plan.dropped === 1 ? "" : "s"} would not fit in one tour.`,
      ""
    );
  }

  steps.forEach((step, index) => {
    // The orientation step points at the scope's own folder, whose id is the scope
    // id rather than a path, so the document names the folder instead of a dot.
    const where = step.kind === "orientation" ? scopePath : step.nodeId;
    lines.push(`${index + 1}. **${where}** — ${describe(step)}`);

    const state = prose[step.nodeId];
    if (state?.status === "ready") {
      if (state.prose.title !== "") {
        lines.push(`   - ${state.prose.title}`);
      }
      if (state.prose.why !== "") {
        lines.push("", state.prose.why, "");
      }
      if (state.prose.lookAt.length > 0) {
        lines.push(`   - also worth opening: ${state.prose.lookAt.join(", ")}`);
      }
    }
    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}
