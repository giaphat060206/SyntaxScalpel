import type { Edge, Node } from "@xyflow/react";

export interface ElkGraphNode {
  id: string;
  width?: number;
  height?: number;
  children?: ElkGraphNode[];
  layoutOptions?: Record<string, string>;
}

export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkGraphNode[];
  edges: ElkGraphEdge[];
}

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.nodeNode": "40",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  "elk.padding": "[top=40,left=20,bottom=20,right=20]",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

const DEFAULT_WIDTH = 180;
const DEFAULT_HEIGHT = 60;

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function leafSize(node: Node): { width: number; height: number } {
  const style = node.style as Record<string, unknown> | undefined;
  return {
    width: node.measured?.width ?? numeric(style?.width) ?? DEFAULT_WIDTH,
    height: node.measured?.height ?? numeric(style?.height) ?? DEFAULT_HEIGHT,
  };
}

export function buildElkGraph(nodes: Node[], edges: Edge[]): ElkGraph {
  const visible = nodes.filter((node) => !node.hidden);
  const visibleIds = new Set(visible.map((node) => node.id));
  const byParent = new Map<string | null, Node[]>();
  for (const node of visible) {
    const key =
      node.parentId && visibleIds.has(node.parentId) ? node.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }

  const build = (parentId: string | null): ElkGraphNode[] =>
    (byParent.get(parentId) ?? []).map((node) => {
      const children = build(node.id);
      if (children.length > 0) {
        return {
          id: node.id,
          children,
          layoutOptions: {
            "elk.padding": "[top=40,left=20,bottom=20,right=20]",
          },
        };
      }
      const size = leafSize(node);
      return { id: node.id, width: size.width, height: size.height };
    });

  return {
    id: "root",
    layoutOptions: { ...ELK_OPTIONS },
    children: build(null),
    edges: edges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
}
