import type { Node } from "@xyflow/react";
import type {
  GraphEdge,
  GraphNode,
  ImportAnalysis,
  ParseResult,
  Position,
} from "../../shared/types";
import { colorForNode } from "./colors";
import { traceNeighbors } from "./trace";
import { type CodeNodeData } from "./CodeNode";
import {
  CLASS_WIDTH,
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
} from "./layout";

interface FlowNode {
  id: string;
  type: "scalpel";
  position: Position;
  parentId?: string;
  extent?: "parent";
  data: { node: GraphNode };
  style?: { width: number; height: number };
}

const CHAR_WIDTH = 7.2;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const ROW_HEIGHT = 130;
const METHOD_ROW = 90;

function naturalWidth(lines: string[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(longest * CHAR_WIDTH) + 32));
}

function graphNodeLines(node: GraphNode): string[] {
  return [
    node.name,
    ...node.params.map((param) => `in: ${param}`),
    ...node.returns.map((value) => `out: ${value}`),
    ...(node.value !== undefined ? [`= ${node.value}`] : []),
  ];
}

function flowNodes(result: ParseResult): FlowNode[] {
  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of result.nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }

  const topLevel = result.nodes.filter((node) => !node.parent);
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
        ? { style: { width: CLASS_WIDTH, height: 60 + METHOD_ROW * children.length } }
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

  return nodes;
}

function specialFlowNodes(imports: ImportAnalysis | null | undefined): Node[] {
  if (!imports) {
    return [];
  }
  const importLines = imports.imports.map((entry) =>
    entry.names.length > 0
      ? `${entry.specifier}: ${entry.names.join(", ")}`
      : entry.specifier
  );
  const importerLines = imports.importedBy.map((entry) =>
    entry.names.length > 0
      ? `${entry.path}: ${entry.names.join(", ")}`
      : entry.path
  );

  return [
    {
      id: IMPORTS_NODE_ID,
      type: "scalpel",
      position: { x: 0, y: 0 },
      style: {
        width: naturalWidth([`IMPORTS (${imports.imports.length})`, ...importLines]),
      },
      draggable: false,
      zIndex: 4,
      data: {
        special: { title: `IMPORTS (${imports.imports.length})`, lines: importLines },
        color: colorForNode(IMPORTS_NODE_ID),
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    },
    {
      id: IMPORTED_BY_NODE_ID,
      type: "scalpel",
      position: { x: 0, y: 300 },
      style: {
        width: naturalWidth([
          `IMPORTED BY (${imports.importedBy.length})`,
          ...importerLines,
        ]),
      },
      draggable: false,
      zIndex: 4,
      data: {
        special: {
          title: `IMPORTED BY (${imports.importedBy.length})`,
          lines: importerLines,
        },
        color: colorForNode(IMPORTED_BY_NODE_ID),
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    },
  ];
}

function visibilityOf(id: string, edges: GraphEdge[], selectedId: string | null) {
  const traced = selectedId ? traceNeighbors(edges, selectedId) : null;
  return {
    highlighted: traced ? traced.has(id) : false,
    dimmed: traced ? !traced.has(id) : false,
  };
}

function toFlowNode(node: FlowNode, endpointParents: Set<string>): Node {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    parentId: node.parentId,
    extent: node.extent,
    style:
      node.style ??
      (node.data.node.kind === "class"
        ? { width: CLASS_WIDTH }
        : { width: naturalWidth(graphNodeLines(node.data.node)) }),
    draggable: node.data.node.kind !== "class",
    zIndex: node.data.node.kind === "class" ? 1 : 4,
    data: {
      node: node.data.node,
      color: colorForNode(node.id),
      transparent: node.data.node.kind === "class" && endpointParents.has(node.id),
      pinned: node.data.node.position != null,
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  };
}

export function buildFunctionNodes(
  result: ParseResult,
  imports: ImportAnalysis | null | undefined
): Node[] {
  const flow = flowNodes(result);
  const variables = flow.filter((node) => node.data.node.kind === "variable");
  const others = flow.filter((node) => node.data.node.kind !== "variable");

  const constantsContainer: Node[] =
    variables.length > 0
      ? [
          {
            id: CONSTANTS_NODE_ID,
            type: "scalpel",
            position: { x: 0, y: 0 },
            style: { width: CLASS_WIDTH },
            draggable: false,
            zIndex: 1,
            data: {
              node: {
                id: CONSTANTS_NODE_ID,
                kind: "class",
                name: `CONSTANTS (${variables.length})`,
                params: [],
                returns: [],
                uses: [],
              },
              color: colorForNode(CONSTANTS_NODE_ID),
              highlighted: false,
              dimmed: false,
            } satisfies CodeNodeData,
          },
        ]
      : [];

  const constantChildren = variables.map((node) => ({
    ...toFlowNode(node, new Set()),
    parentId: CONSTANTS_NODE_ID,
    extent: "parent" as const,
  }));

  const endpointParents = new Set<string>();
  for (const edge of result.edges) {
    for (const id of [edge.source, edge.target]) {
      const dot = id.lastIndexOf(".");
      if (dot > 0) {
        endpointParents.add(id.slice(0, dot));
      }
    }
  }

  return [
    ...specialFlowNodes(imports),
    ...constantsContainer,
    ...constantChildren,
    ...others.map((node) => toFlowNode(node, endpointParents)),
  ];
}

export function decorateFunctionNodes(
  nodes: Node[],
  edges: GraphEdge[],
  selectedId: string | null
): Node[] {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      ...visibilityOf(node.id, edges, selectedId),
    },
  }));
}
