import type { GraphEdge, GraphNode, ParseResult, Position } from "../../shared/types";

export interface FlowNode {
  id: string;
  type: "scalpel";
  position: Position;
  parentId?: string;
  extent?: "parent";
  data: { node: GraphNode };
  style?: { width: number; height: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "step";
}

const ROW_HEIGHT = 130;
const METHOD_ROW = 90;

export function buildFlow(result: ParseResult): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of result.nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }

  const topLevel = result.nodes.filter((n) => !n.parent);
  const nodes: FlowNode[] = [];
  let row = 0;

  for (const node of topLevel) {
    const children = childrenOf.get(node.id) ?? [];
    const autoPosition: Position = { x: 0, y: ROW_HEIGHT * row };
    nodes.push({
      id: node.id,
      type: "scalpel",
      position: node.position ?? autoPosition,
      data: { node },
      ...(node.kind === "class"
        ? { style: { width: 240, height: 60 + METHOD_ROW * children.length } }
        : {}),
    });
    row += 1;

    children.forEach((child, index) => {
      nodes.push({
        id: child.id,
        type: "scalpel",
        parentId: node.id,
        extent: "parent",
        position: child.position ?? { x: 20, y: 76 + METHOD_ROW * index },
        data: { node: child },
      });
    });
  }

  const edges: FlowEdge[] = result.edges.map((edge: GraphEdge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "step",
  }));

  return { nodes, edges };
}
