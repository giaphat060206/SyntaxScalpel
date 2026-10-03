import type { Node } from "@xyflow/react";
import type {
  ExternalFile,
  FunctionGraph,
  GraphEdge,
  GraphNode,
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
  data: { node: GraphNode; external?: "file" | "definition" };
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

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function flowNodes(result: FunctionGraph["file"]): FlowNode[] {
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
      position: autoPosition,
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
        position: { x: 20, y: 76 + METHOD_ROW * index },
        data: { node: child },
      });
    });
  }

  return nodes;
}

/**
 * One dashed block per file a Call Edge reaches, holding only the Definitions
 * it reaches. The block is the single Container for those Definitions, so the
 * canvas never nests deeper than the layout can render.
 */
function externalFlowNodes(externals: ExternalFile[]): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const file of externals) {
    nodes.push({
      id: file.path,
      type: "scalpel",
      position: { x: 0, y: 0 },
      data: {
        node: {
          id: file.path,
          kind: "class",
          name: fileName(file.path),
          params: [],
          returns: [],
          uses: [],
        },
        external: "file",
      },
      style: { width: CLASS_WIDTH, height: 60 + METHOD_ROW * file.nodes.length },
    });
    file.nodes.forEach((definition, index) => {
      nodes.push({
        id: definition.id,
        type: "scalpel",
        parentId: file.path,
        extent: "parent",
        position: { x: 20, y: 76 + METHOD_ROW * index },
        data: { node: definition, external: "definition" },
      });
    });
  }
  return nodes;
}

/**
 * Imports and importers no dashed block could draw, so they stay readable as
 * text. Each block is omitted entirely when there is nothing left to show.
 */
function specialFlowNodes(graph: FunctionGraph): Node[] {
  const blocks: Node[] = [];
  const add = (id: string, title: string, lines: string[]) => {
    if (lines.length === 0) {
      return;
    }
    blocks.push({
      id,
      type: "scalpel",
      position: { x: 0, y: 0 },
      style: { width: naturalWidth([title, ...lines]) },
      draggable: false,
      zIndex: 4,
      data: {
        special: { title, lines },
        color: colorForNode(id),
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    });
  };

  add(
    IMPORTS_NODE_ID,
    `IMPORTS NOT DRAWN (${graph.residualImports.length})`,
    graph.residualImports.map((entry) =>
      entry.names.length > 0
        ? `${entry.specifier}: ${entry.names.join(", ")}`
        : entry.specifier
    )
  );
  add(
    IMPORTED_BY_NODE_ID,
    `IMPORTERS NOT DRAWN (${graph.residualImportedBy.length})`,
    graph.residualImportedBy.map((entry) =>
      entry.names.length > 0
        ? `${entry.path}: ${entry.names.join(", ")}`
        : entry.path
    )
  );

  return blocks;
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
      external: node.data.external,
      color: colorForNode(node.id),
      transparent: node.data.node.kind === "class" && endpointParents.has(node.id),
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  };
}

export function buildFunctionNodes(graph: FunctionGraph): Node[] {
  const flow = [...flowNodes(graph.file), ...externalFlowNodes(graph.externals)];
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

  // A Container holding an edge endpoint stays transparent so the line shows
  // through it. The owning Container is the child's parentId, which is the only
  // thing that identifies it for both in-file `Class.method` ids and the
  // `path::Container.method` ids of external Definitions.
  const parentOf = new Map(flow.map((node) => [node.id, node.parentId]));
  const endpointParents = new Set<string>();
  for (const edge of [...graph.file.edges, ...graph.crossEdges]) {
    for (const id of [edge.source, edge.target]) {
      const parent = parentOf.get(id);
      if (parent) {
        endpointParents.add(parent);
      }
    }
  }

  return [
    ...specialFlowNodes(graph),
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
