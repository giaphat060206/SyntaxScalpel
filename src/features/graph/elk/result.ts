import type { Node } from "@xyflow/react";

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkLayoutResult {
  positions: Record<string, ElkPoint>;
  sizes: Record<string, { width: number; height: number }>;
  sections: Record<string, ElkPoint[]>;
}

interface ElkNodeLike {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNodeLike[];
}

interface ElkSectionLike {
  startPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  endPoint: ElkPoint;
}

interface ElkEdgeLike {
  id: string;
  sources?: string[];
  targets?: string[];
  sections?: ElkSectionLike[];
}

export interface ElkResultLike {
  children?: ElkNodeLike[];
  edges?: ElkEdgeLike[];
}

/**
 * ELK reports a node's x/y relative to its parent, which is exactly what React
 * Flow expects for child nodes, so positions are copied straight through.
 * Edge sections come in the coordinate space of the edge's lowest common
 * ancestor container, so they are shifted by that container's absolute offset.
 */
export function applyElkResult(nodes: Node[], elk: ElkResultLike): ElkLayoutResult {
  const positions: Record<string, ElkPoint> = {};
  const sizes: Record<string, { width: number; height: number }> = {};
  const absolute: Record<string, ElkPoint> = {};

  const walk = (children: ElkNodeLike[], parentAbsolute: ElkPoint) => {
    for (const child of children) {
      const here = {
        x: parentAbsolute.x + (child.x ?? 0),
        y: parentAbsolute.y + (child.y ?? 0),
      };
      absolute[child.id] = here;
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
      if (
        child.children?.length &&
        child.width !== undefined &&
        child.height !== undefined
      ) {
        sizes[child.id] = { width: child.width, height: child.height };
      }
      if (child.children?.length) {
        walk(child.children, here);
      }
    }
  };
  walk(elk.children ?? [], { x: 0, y: 0 });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const ancestorsOf = (id: string): string[] => {
    const chain: string[] = [];
    let current = nodeById.get(id)?.parentId;
    while (current) {
      chain.push(current);
      current = nodeById.get(current)?.parentId;
    }
    return chain;
  };

  const lowestCommonAncestor = (a?: string, b?: string): string | null => {
    if (!a || !b) {
      return null;
    }
    const chainA = new Set(ancestorsOf(a));
    for (const id of ancestorsOf(b)) {
      if (chainA.has(id)) {
        return id;
      }
    }
    return null;
  };

  const sections: Record<string, ElkPoint[]> = {};
  for (const edge of elk.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) {
      continue;
    }
    const lca = lowestCommonAncestor(edge.sources?.[0], edge.targets?.[0]);
    const offset = lca ? absolute[lca] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    sections[edge.id] = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));
  }

  return { positions, sizes, sections };
}
