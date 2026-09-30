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
import { colorForNode } from "./colors";
import {
  CONSTANTS_NODE_ID,
  IMPORTED_BY_NODE_ID,
  IMPORTS_NODE_ID,
  CLASS_WIDTH,
  reflowLayout,
} from "./layout";
import { runElkLayout } from "./elk/layout";
import { ElkEdge } from "./elk/ElkEdge";
import { EmptyState } from "../../shared/StateViews";

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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(true);
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
  const { fitView, getInternalNode, setCenter } = useReactFlow();
  const lastFit = useRef<string>("");
  const lastLayoutKey = useRef<string>("");

  // Rebuild the flow whenever a different file (or its import analysis) changes.
  useEffect(() => {
    setSections({});
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

  // Edges are routed by ELK from the section points it computed, falling back to
  // a smooth step in `ElkEdge` until a section exists. Idle edges are faded.
  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return result.edges.map((edge) => {
      const id = `${edge.source}->${edge.target}`;
      const source = byId.get(edge.source);
      const active =
        selectedId !== null &&
        (edge.source === selectedId || edge.target === selectedId);
      const unrelated = selectedId !== null && !active;
      const sourceColor =
        (source?.data as CodeNodeData | undefined)?.color ?? "#00F0FF";
      const stroke = sourceColor;
      return {
        id,
        source: edge.source,
        target: edge.target,
        type: "elk",
        data: { points: sections[id] },
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
          opacity: unrelated ? 0.12 : active ? 1 : showLines ? 0.7 : 0,
        },
      };
    });
  }, [nodes, result.edges, selectedId, sections, showLines]);

  const edgesForLayout = edges;

  // ELK owns placement: run it once the measured sizes settle, and again after a
  // Re-align. On any failure (or above the node cap) fall back to the old grid.
  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}`)
    .join("|");
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
    const filePath = result.filePath;
    const timer = window.setTimeout(async () => {
      const result = await runElkLayout(nodes, edgesForLayout);
      if (cancelled) {
        return;
      }
      if (!result) {
        setSections({});
        setNodes((current) => reflowLayout(current));
        return;
      }
      const key = `${filePath}|${layoutRun}|${sizeSignature}|${showLines}`;
      if (lastLayoutKey.current === key) {
        return;
      }
      lastLayoutKey.current = key;
      setSections(result.sections);
      setNodes((current) =>
        current.map((node) => {
          const position = result.positions[node.id];
          const size = result.sizes[node.id];
          if (!position) {
            return node;
          }
          return {
            ...node,
            position,
            ...(size
              ? { style: { ...(node.style ?? {}), ...size } }
              : {}),
          };
        })
      );
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sizeSignature, layoutRun, result.filePath, setNodes]);

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
    setSections({});
    setLayoutRun((value) => value + 1);
  }, []);

  const handleFitView = useCallback(() => {
    setMenu(null);
    fitView({ padding: 0.2 });
  }, [fitView]);

  // Centre the viewport on one node at a given zoom (used by search picks).
  const centerOn = useCallback(
    (id: string, zoom: number, duration: number) => {
      const internals = getInternalNode(id);
      if (!internals) {
        return;
      }
      const { positionAbsolute, userNode } = internals.internals;
      const width = userNode.measured?.width ?? 0;
      const height = userNode.measured?.height ?? 0;
      if (width === 0 || height === 0) {
        return;
      }
      setCenter(
        positionAbsolute.x + width / 2,
        positionAbsolute.y + height / 2,
        { zoom, duration }
      );
    },
    [getInternalNode, setCenter]
  );

  const searchItems = useMemo<SearchItem[]>(
    () =>
      nodes
        .map((node) => (node.data as CodeNodeData).node)
        .filter((graph): graph is NonNullable<typeof graph> => Boolean(graph))
        .map((graph) => ({
          id: graph.id,
          label: graph.name,
          hint: graph.kind,
        })),
    [nodes]
  );

  useSearchRegistration(searchItems, (id) => {
    onSelect(id);
    centerOn(id, 1.2, 400);
  });

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
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
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

      <button
        type="button"
        onClick={() => setShowLines((value) => !value)}
        className="absolute bottom-3 left-12 z-10 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
      >
        {showLines ? "Hide lines" : "Show lines"}
      </button>

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
