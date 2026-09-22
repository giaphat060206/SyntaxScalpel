import type { GraphEdge } from "../../shared/types";

export function traceNeighbors(edges: GraphEdge[], nodeId: string): Set<string> {
  const hits = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) hits.add(edge.target);
    if (edge.target === nodeId) hits.add(edge.source);
  }
  return hits;
}
