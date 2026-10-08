import type { ProjectGraph } from "../../shared/types";

/** A tour stops here and then gives up, saying how many files it left out. */
export const MAX_TOUR_STEPS = 12;

export interface TourStep {
  /** The canvas node this step moves to, and the step's identity. */
  nodeId: string;
  kind: "orientation" | "entry" | "module";
  /** Highlighted alongside the focal node — its folder, so a step shows where it lives. */
  alsoIds: string[];
  /** Import hops from the entry point; null when nothing reaches it from there. */
  depth: number | null;
  /** In-scope code files that import this one. */
  dependents: number;
}

export interface TourPlan {
  steps: TourStep[];
  /** Files the cap left out, so the panel can say how many. */
  dropped: number;
  truncated: boolean;
}

function firstEntry(graph: ProjectGraph): string | null {
  const candidates = [graph.entry, ...(graph.entries ?? [])];
  return candidates.find((id): id is string => typeof id === "string" && id !== "") ?? null;
}

/** Import hops from the entry, following import edges outwards. */
function depthsFrom(graph: ProjectGraph, entry: string, inScope: Set<string>): Map<string, number> {
  const depth = new Map<string, number>([[entry, 0]]);
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const next = (depth.get(current) ?? 0) + 1;
    for (const edge of graph.edges) {
      if (edge.source !== current || !inScope.has(edge.target) || depth.has(edge.target)) {
        continue;
      }
      depth.set(edge.target, next);
      queue.push(edge.target);
    }
  }

  return depth;
}

/**
 * A reading order for the code in this payload, computed rather than asked for.
 *
 * The shape is fixed by the parse — where the program starts, and which modules the
 * most code depends on — so two runs over the same project produce the same tour,
 * and a project with no API key still has one. Sorting is a total order (distance,
 * then dependents, then path) precisely so the steps cannot reshuffle underneath a
 * reader between runs.
 */
export function planTour(graph: ProjectGraph): TourPlan {
  const code = graph.files.filter((file) => !file.external && file.kind === "code");
  // Nothing to read in order: a project of docs has no tour, and saying so beats a
  // one-step tour that only names the folder you are already looking at.
  if (code.length === 0) {
    return { steps: [], dropped: 0, truncated: false };
  }

  const inScope = new Set(code.map((file) => file.id));
  const folderIds = new Set(graph.folders.map((folder) => folder.id));
  const folderOf = new Map(code.map((file) => [file.id, file.folderId]));

  const dependents = new Map<string, number>();
  for (const edge of graph.edges) {
    if (inScope.has(edge.source) && inScope.has(edge.target)) {
      dependents.set(edge.target, (dependents.get(edge.target) ?? 0) + 1);
    }
  }

  const entry = firstEntry(graph);
  const reached = entry && inScope.has(entry) ? entry : null;
  const depth = reached ? depthsFrom(graph, reached, inScope) : new Map<string, number>();

  const step = (nodeId: string, kind: TourStep["kind"]): TourStep => {
    const folderId = folderOf.get(nodeId);
    const alsoIds =
      folderId && folderId !== nodeId && folderIds.has(folderId) ? [folderId] : [];
    return {
      nodeId,
      kind,
      alsoIds,
      depth: depth.get(nodeId) ?? null,
      dependents: dependents.get(nodeId) ?? 0,
    };
  };

  // The scope's own folder, which is the payload's root id — "." for a whole project.
  const orientationNode =
    folderIds.has(graph.root) || inScope.has(graph.root)
      ? graph.root
      : (graph.folders[0]?.id ?? graph.root);

  const steps: TourStep[] = [step(orientationNode, "orientation")];
  if (reached) {
    steps.push(step(reached, "entry"));
  }

  const rest = code
    .filter((file) => file.id !== reached)
    .sort(
      (a, b) =>
        (depth.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (depth.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        (dependents.get(b.id) ?? 0) - (dependents.get(a.id) ?? 0) ||
        a.id.localeCompare(b.id)
    );

  const room = Math.max(0, MAX_TOUR_STEPS - steps.length);
  for (const file of rest.slice(0, room)) {
    steps.push(step(file.id, "module"));
  }

  const dropped = rest.length - Math.min(rest.length, room);
  return { steps, dropped, truncated: dropped > 0 };
}
