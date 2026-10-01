import {
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  GraphEdge,
  GraphNode,
  ImportAnalysis,
  ParseResult,
} from "../../shared/types";
import { buildFlow, type FlowNode } from "./flow";
import { traceNeighbors } from "./trace";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { useSearchRegistration, type SearchItem } from "../shell/SearchContext";
import { GraphSearch } from "./GraphSearch";
import { colorForNode } from "./colors";
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
  CLASS_WIDTH,
} from "./layout";
import { ElkEdge } from "./elk/ElkEdge";
import { EmptyState } from "../../shared/StateViews";
import {
  useGraphCanvas,
  type DomainEdge,
  type EdgeVisibility,
} from "./canvas/useGraphCanvas";

const nodeTypes = { scalpel: CodeNode };
const edgeTypes = { elk: ElkEdge };

// Content-aware sizing: estimate the width a monospace line needs so a single
// `in:`/`out:`/value stays on one line by default. Height stays content-driven.
const CHAR_WIDTH = 7.2;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

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

function toFlowNode(
  node: FlowNode,
  selectedId: string | null,
  edges: GraphEdge[],
  endpointParents: Set<string> = new Set()
): Node {
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
      ...visibilityOf(node.id, edges, selectedId),
    } satisfies CodeNodeData,
  };
}

interface Props {
  result: ParseResult;
  imports?: ImportAnalysis | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function GraphView(props: Props) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}

function GraphViewInner({
  result,
  imports,
  selectedId,
  onSelect,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Rebuild the flow whenever a different file (or its import analysis) changes.
  const builtNodes = useMemo<Node[]>(() => {
    const flow = buildFlow(result);
    const variables = flow.nodes.filter(
      (node) => node.data.node.kind === "variable"
    );
    const others = flow.nodes.filter((node) => node.data.node.kind !== "variable");

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
      ...toFlowNode(node, null, result.edges),
      parentId: CONSTANTS_NODE_ID,
      extent: "parent" as const,
    }));

    // Class ids that own an edge endpoint stay transparent so their method
    // lines remain visible through the class container.
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
      ...others.map((node) => toFlowNode(node, null, result.edges, endpointParents)),
    ];
  }, [result, imports]);

  // A selection that does not match any node on the canvas (stale id from a
  // previous file) must not dim the whole graph.
  const activeSelectedId = useMemo(
    () =>
      selectedId !== null && builtNodes.some((node) => node.id === selectedId)
        ? selectedId
        : null,
    [selectedId, builtNodes]
  );

  // Re-decorate for trace highlighting without touching positions the user
  // dragged. Class transparency comes from the rebuild (endpoint-based), so it
  // is preserved here.
  const decoratedNodes = useMemo<Node[]>(
    () =>
      builtNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          ...visibilityOf(node.id, result.edges, activeSelectedId),
        },
      })),
    [builtNodes, result.edges, activeSelectedId]
  );

  const domainEdges = useMemo<DomainEdge[]>(
    () =>
      result.edges.map((edge) => ({
        ...edge,
        id: `${edge.source}->${edge.target}`,
      })),
    [result.edges]
  );

  const handleEdgeVisibility = useCallback(
    (edge: DomainEdge, selected: unknown): EdgeVisibility => {
      if (typeof selected !== "string") return "active";
      return edge.source === selected || edge.target === selected
        ? "active"
        : "dim";
    },
    []
  );

  const layoutKey = `${result.filePath}|${imports ? imports.imports.length : "none"}`;

  const canvas = useGraphCanvas({
    nodes: decoratedNodes,
    edges: domainEdges,
    selection: activeSelectedId,
    layoutKey,
    fit: { token: layoutKey },
    edgeVisibility: handleEdgeVisibility,
    onNodeClick: (id) => onSelect(id),
    onHover: setHoveredId,
    onPaneClick: () => onSelect(null),
  });

  const searchItems = useMemo<SearchItem[]>(
    () =>
      canvas.nodes
        .map((node) => (node.data as CodeNodeData).node)
        .filter((graph): graph is NonNullable<typeof graph> => Boolean(graph))
        .map((graph) => ({
          id: graph.id,
          label: graph.name,
          hint: graph.kind,
        })),
    [canvas.nodes]
  );

  const handleSearchPick = useCallback(
    (id: string) => {
      onSelect(id);
      canvas.centerOn(id, 1.2, 400);
    },
    [onSelect, canvas.centerOn]
  );

  // The explorer's search picks the same way (a function cannot be "opened").
  useSearchRegistration(searchItems, handleSearchPick);

  if (result.nodes.length === 0) {
    return <EmptyState message="No functions detected" />;
  }

  const activeId = activeSelectedId ?? hoveredId;
  const activeNode = activeId
    ? canvas.nodes.find((node) => node.id === activeId)
    : undefined;
  const activeGraph = activeNode
    ? (activeNode.data as CodeNodeData).node
    : undefined;
  const activeUses = activeGraph?.uses ?? [];
  const activeImporters =
    imports && activeGraph
      ? imports.importedBy.filter((entry) => entry.names.includes(activeGraph.name))
      : [];
  const moduleImporters =
    imports && activeGraph
      ? imports.importedBy.filter((entry) => entry.names.length === 0)
      : [];

  return (
    <div
      className="relative h-full bg-bg"
      // Suppress WebView2's native context menu everywhere in the canvas (including
      // on our own menu), so only the custom menu below ever shows.
      onContextMenu={(event) => event.preventDefault()}
    >
      {result.nodes.length > 5000 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
          Large file: {result.nodes.length} nodes — performance may degrade
        </div>
      )}
      <ReactFlow
        nodes={canvas.nodes}
        edges={canvas.edges}
        onNodesChange={canvas.onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onNodeMouseEnter={(_event, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        onPaneClick={() => {
          canvas.closeMenu();
          onSelect(null);
        }}
        onPaneContextMenu={(event) => canvas.openMenu(event)}
        onNodeContextMenu={(event, node) => canvas.openMenu(event, node.id)}
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2A3138" gap={20} />
        <Controls />
      </ReactFlow>

      <button
        type="button"
        onClick={canvas.toggleLines}
        className="absolute bottom-3 left-12 z-10 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
      >
        {canvas.showLines ? "Hide lines" : "Show lines"}
      </button>

      <GraphSearch
        items={searchItems}
        onPick={handleSearchPick}
        placeholder="Search functions and methods…"
      />

      {activeGraph && (
        <div className="absolute right-3 top-12 z-20 max-h-[60%] w-72 overflow-auto rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
          <div className="break-words font-mono text-sm text-accent">
            {activeGraph.name}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Uses imports
          </div>
          <div className="break-words font-mono text-white/85">
            {activeUses.length > 0 ? activeUses.join(", ") : "none"}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Imported by
          </div>
          <div className="font-mono text-white/85">
            {activeImporters.length === 0 && moduleImporters.length === 0 ? (
              <div>none</div>
            ) : (
              <>
                {activeImporters.map((entry) => (
                  <div key={entry.path} className="break-words">
                    {entry.path}:{" "}
                    {entry.names
                      .filter((name) => name === activeGraph.name)
                      .join(", ")}
                  </div>
                ))}
                {moduleImporters.map((entry) => (
                  <div key={entry.path} className="break-words text-white/60">
                    {entry.path} (module)
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {canvas.menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={canvas.closeMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              canvas.closeMenu();
            }}
          />
          <div
            className="fixed z-50 min-w-[160px] rounded border border-white/10 bg-panel py-1 shadow-lg"
            style={{ left: canvas.menu.x, top: canvas.menu.y }}
          >
            <button
              type="button"
              onClick={canvas.realign}
              className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              Re-align nodes
            </button>
            <button
              type="button"
              onClick={canvas.fitView}
              className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              Fit view
            </button>
          </div>
        </>
      )}
    </div>
  );
}
