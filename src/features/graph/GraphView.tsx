import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  GraphEdge,
  GraphNode,
  ImportAnalysis,
  LayoutMap,
  ParseResult,
} from "../../shared/types";
import { buildFlow, type FlowNode } from "./flow";
import { traceNeighbors } from "./trace";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { colorForNode } from "./colors";
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
  CLASS_WIDTH,
  spreadHandles,
  reflowLayout,
} from "./layout";
import { EmptyState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };

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
  onDragStop: (positions: LayoutMap) => void;
  onResetLayout?: () => void;
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
  onDragStop,
  onResetLayout,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { fitView } = useReactFlow();
  const lastFit = useRef<string>("");

  // Rebuild the flow whenever a different file (or its import analysis) changes.
  useEffect(() => {
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

    setNodes([
      ...specialFlowNodes(imports),
      ...constantsContainer,
      ...constantChildren,
      ...others.map((node) => toFlowNode(node, null, result.edges, endpointParents)),
    ]);
  }, [result, imports, setNodes]);

  // Re-decorate for trace highlighting without touching positions the user
  // dragged. Class transparency comes from the rebuild (endpoint-based), so it
  // is preserved here.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, ...visibilityOf(node.id, result.edges, selectedId) },
      }))
    );
  }, [selectedId, result.edges, setNodes]);

  // Edges are derived from the current node positions so their handles can face
  // the other block; each block rotates its edges across its four sides so
  // parallel lines do not stack, and idle edges are faded for readability.
  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const outCount = new Map<string, number>();
    const inCount = new Map<string, number>();
    return result.edges.map((edge, edgeIndex) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const sourceIndex = outCount.get(edge.source) ?? 0;
      const targetIndex = inCount.get(edge.target) ?? 0;
      outCount.set(edge.source, sourceIndex + 1);
      inCount.set(edge.target, targetIndex + 1);
      const handles =
        source && target
          ? spreadHandles(source, target, byId, sourceIndex, targetIndex)
          : {};
      const active =
        selectedId !== null &&
        (edge.source === selectedId || edge.target === selectedId);
      const unrelated = selectedId !== null && !active;
      const sourceColor =
        (source?.data as CodeNodeData | undefined)?.color ?? "#00F0FF";
      const stroke = sourceColor;
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        pathOptions: { borderRadius: 14, offset: 24 + (edgeIndex % 4) * 16 },
        ...handles,
        zIndex: 0,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 16,
          height: 16,
        },
        style: {
          stroke,
          strokeWidth: 2,
          opacity: unrelated ? 0.12 : active ? 1 : 0.7,
        },
      };
    });
  }, [nodes, result.edges, selectedId]);

  // Re-stack once React Flow has measured real node heights, and again after any
  // resize. Keyed on a height signature so dragging positions never triggers a
  // reflow, and converges because `reflowLayout` returns the same array when
  // nothing needs to move.
  // Re-stack once the measured heights have settled. With many nodes, React Flow
  // measures them in waves; coalescing the reflow avoids re-gridding the whole
  // graph dozens of times (which reads as the graph flinging around).
  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}`)
    .join("|");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNodes((current) => reflowLayout(current));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [sizeSignature, setNodes]);

  // Fit the view once per file (and once more when import blocks arrive), after
  // React Flow has measured the nodes.
  const fitToken = `${result.filePath}|${imports ? imports.imports.length : "none"}|${
    imports ? imports.importedBy.length : "none"
  }`;
  useEffect(() => {
    if (lastFit.current === fitToken) {
      return;
    }
    const id = window.setTimeout(() => {
      lastFit.current = fitToken;
      fitView({ padding: 0.2 });
    }, 120);
    return () => window.clearTimeout(id);
  }, [fitToken, sizeSignature, fitView]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleRealign = useCallback(() => {
    setMenu(null);
    const cleared: ParseResult = {
      ...result,
      nodes: result.nodes.map((node) => ({ ...node, position: undefined })),
    };
    const flow = buildFlow(cleared);
    setNodes([
      ...specialFlowNodes(imports),
      ...flow.nodes.map((node) => toFlowNode(node, null, result.edges)),
    ]);
    lastFit.current = "";
    onResetLayout?.();
    window.setTimeout(() => {
      lastFit.current = fitToken;
      fitView({ padding: 0.2 });
    }, 80);
  }, [result, imports, setNodes, onResetLayout, fitView, fitToken]);

  const handleFitView = useCallback(() => {
    setMenu(null);
    fitView({ padding: 0.2 });
  }, [fitView]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => onSelect(node.id),
    [onSelect]
  );

  const handleNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => setHoveredId(node.id),
    []
  );

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(
    () => setHoveredId(null),
    []
  );

  const handleDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      // Save the FULL layout, not just the dragged node. `save_layout` replaces the
      // entry for this file, so sending one node would erase every other node's
      // saved position on the next open.
      const positions: LayoutMap = {};
      for (const current of nodes) {
        const position = current.id === node.id ? node.position : current.position;
        positions[current.id] = { x: position.x, y: position.y };
      }
      // Mark the dragged node pinned so auto-reflow leaves its position alone.
      setNodes((current) =>
        current.map((item) =>
          item.id === node.id
            ? { ...item, data: { ...item.data, pinned: true } }
            : item
        )
      );
      onDragStop(positions);
    },
    [nodes, onDragStop, setNodes]
  );

  // Close the context menu on Escape.
  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu]);

  if (result.nodes.length === 0) {
    return <EmptyState message="No functions detected" />;
  }

  const activeId = selectedId ?? hoveredId;
  const activeNode = activeId
    ? nodes.find((node) => node.id === activeId)
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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onNodeDragStop={handleDragStop}
        onPaneClick={() => {
          closeMenu();
          onSelect(null);
        }}
        onPaneContextMenu={openMenu}
        onNodeContextMenu={openMenu}
        fitView
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2A3138" gap={20} />
        <Controls />
      </ReactFlow>

      {activeGraph && (
        <div className="absolute right-3 top-3 z-20 max-h-[60%] w-72 overflow-auto rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
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

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
            onContextMenu={(event) => {
              event.preventDefault();
              closeMenu();
            }}
          />
          <div
            className="fixed z-50 min-w-[160px] rounded border border-white/10 bg-panel py-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              onClick={handleRealign}
              className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              Re-align nodes
            </button>
            <button
              type="button"
              onClick={handleFitView}
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
