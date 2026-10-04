import { createContext, useContext, type ReactNode } from "react";
import type { EdgeVisibility } from "./canvas/useGraphCanvas";

/** The two ends of the connection a pointer is over, as canvas node ids. */
export interface Emphasis {
  ids: string[];
}

interface Value {
  emphasis: Emphasis | null;
  setEmphasis: (next: Emphasis | null) => void;
}

const EmphasisContext = createContext<Value>({
  emphasis: null,
  setEmphasis: () => {},
});

/** Controlled on purpose: the shell owns one piece of state, so a hover from the
 *  AI panel and a hover from an info card drive the same emphasis. */
export function EmphasisProvider({
  value,
  children,
}: {
  value: Value;
  children: ReactNode;
}) {
  return <EmphasisContext.Provider value={value}>{children}</EmphasisContext.Provider>;
}

export function useEmphasis(): Value {
  return useContext(EmphasisContext);
}

/** Whether an edge is the one being emphasised. An edge that merely touches one
 *  end does not qualify: the point is to show the connection itself. */
export function isEmphasisedEdge(
  edge: { source: string; target: string },
  emphasis: Emphasis | null
): boolean {
  if (!emphasis || emphasis.ids.length < 2) {
    return false;
  }
  const [first, second] = emphasis.ids;
  return (
    (edge.source === first && edge.target === second) ||
    (edge.source === second && edge.target === first)
  );
}

/** A node is in focus when it is one of the two ends. */
export function isEmphasisedNode(id: string, emphasis: Emphasis | null): boolean {
  return Boolean(emphasis?.ids.includes(id));
}

/** Edges keep the pair bright and dim the rest while an emphasis is up, and fall
 *  back to the selection's own rule otherwise. */
export function emphasisVisibility(
  edge: { source: string; target: string },
  emphasis: Emphasis | null,
  withoutEmphasis: () => EdgeVisibility
): EdgeVisibility {
  if (!emphasis) {
    return withoutEmphasis();
  }
  return isEmphasisedEdge(edge, emphasis) ? "active" : "dim";
}
