import { useCallback, useMemo, useState } from "react";
import type { ProjectGraph } from "../../shared/types";
import { planTour, type TourPlan, type TourStep } from "./plan";

export interface Tour {
  plan: TourPlan | null;
  steps: TourStep[];
  index: number;
  total: number;
  step: TourStep | null;
  atStart: boolean;
  atEnd: boolean;
  goTo: (index: number) => void;
  next: () => void;
  previous: () => void;
}

/**
 * The steps of a tour and where the reader is in it. The plan is derived from the
 * payload that is already loaded, so there is nothing to fetch, nothing to fail and
 * no key involved — a tour exists before any AI does.
 */
export function useTour(graph: ProjectGraph | null): Tour {
  const plan = useMemo<TourPlan | null>(() => (graph ? planTour(graph) : null), [graph]);
  const steps = plan?.steps ?? [];

  // A different payload is a different tour, which starts at its own first step. The
  // cursor carries the plan it belongs to, so a stale one is simply ignored rather
  // than reset in an effect — no frame ever shows the wrong step.
  const key = graph ? `${graph.root}|${graph.files.length}|${graph.edges.length}` : "";
  const [cursor, setCursor] = useState({ key: "", index: 0 });
  const index = cursor.key === key ? cursor.index : 0;

  const goTo = useCallback(
    (next: number) => {
      const last = Math.max(0, steps.length - 1);
      setCursor({ key, index: Math.max(0, Math.min(next, last)) });
    },
    [key, steps.length]
  );

  return {
    plan,
    steps,
    index,
    total: steps.length,
    step: steps[index] ?? null,
    atStart: index === 0,
    atEnd: steps.length === 0 || index >= steps.length - 1,
    goTo,
    next: useCallback(() => goTo(index + 1), [goTo, index]),
    previous: useCallback(() => goTo(index - 1), [goTo, index]),
  };
}
