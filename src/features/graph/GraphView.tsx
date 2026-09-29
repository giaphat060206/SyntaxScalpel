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
import { EmptyState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };

// Auto-layout geometry (pixels). Class containers stack their methods using the
// measured heights, so wrapped params/returns can never overlap the next method.
const CHILD_X = 20;
const CHILD_WIDTH = 200;
const CHILD_GAP = 12;
const CLASS_HEADER = 76;
const CLASS_PAD = 12;
const CLASS_WIDTH = 240;
const TOP_GAP = 40;
const TOP_WIDTH = 240;

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

const IMPORTS_NODE_ID = "__imports";
const IMPORTED_BY_NODE_ID = "__imported_by";
const CONSTANTS_NODE_ID = "__constants";

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

function nodeHeight(node: Node): number {
  const styleHeight = (node.style as { height?: number } | undefined)?.height;
  return node.measured?.height ?? node.height ?? styleHeight ?? 96;
}

function absolutePosition(node: Node, byId: Map<string, Node>): { x: number; y: number } {
  if (node.parentId) {
    const parent = byId.get(node.parentId);
    if (parent) {
      return {
        x: parent.position.x + node.position.x,
        y: parent.position.y + node.position.y,
      };
    }
  }
  return node.position;
}

/**
 * Pick the handles that face the other node so edges leave from the side
 * (right→left) when blocks are side by side, and top/bottom when stacked.
 */
function pickHandles(
  source: Node,
  target: Node,
  byId: Map<string, Node>
): { sourceHandle?: string; targetHandle?: string } {
  const from = absolutePosition(source, byId);
  const to = absolutePosition(target, byId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceHandle: "r-out", targetHandle: "l-in" }
      : { sourceHandle: "l-out", targetHandle: "r-in" };
  }
  return dy > 0
    ? { sourceHandle: "b-out", targetHandle: "t-in" }
    : { sourceHandle: "t-out", targetHandle: "b-in" };
}

/**
 * Near-square grid positions for a set of nodes: 9 -> 3x3, 10 -> 3 cols x 4
 * rows, 16 -> 4x4. Column widths come from each column's widest block.
 */
function arrangeGrid(
  items: Node[],
  startX: number,
  startY: number,
  gapX: number,
  gapY: number
): {
  positions: { x: number; y: number }[];
  right: number;
  bottom: number;
} {
  const count = items.length;
  const cols = Math.max(1, Math.floor(Math.sqrt(count)));
  const columnWidths = new Array<number>(cols).fill(0);
  const rowHeights: number[] = [];
  items.forEach((node, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const width =
      (node.style as { width?: number } | undefined)?.width ?? CHILD_WIDTH;
    columnWidths[column] = Math.max(columnWidths[column], width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, nodeHeight(node));
  });

  const columnX: number[] = [];
  let cursorX = startX;
  for (let column = 0; column < cols; column++) {
    columnX[column] = cursorX;
    cursorX += columnWidths[column] + gapX;
  }
  const rowY: number[] = [];
  let cursorY = startY;
  for (let row = 0; row < rowHeights.length; row++) {
    rowY[row] = cursorY;
    cursorY += rowHeights[row] + gapY;
  }

  return {
    positions: items.map((_, index) => ({
      x: columnX[index % cols],
      y: rowY[Math.floor(index / cols)],
    })),
    right: cursorX - gapX,
    bottom: cursorY - gapY,
  };
}

/**
 * Stack a class node's methods by their real heights and give the class the
 * matching height, then stack top-level nodes that the user has not pinned.
 * Converges: returns the same array reference when nothing needs to change.
 */
function reflowLayout(current: Node[]): Node[] {
  const childrenByParent = new Map<string, Node[]>();
  for (const node of current) {
    if (!node.parentId) continue;
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }

  const next = current.map((node) => ({ ...node }));
  let changed = false;

  for (const parent of next) {
    const children = childrenByParent.get(parent.id);
    if (!children || children.length === 0) continue;
    children.sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
    );

    const compact = parent.id === CONSTANTS_NODE_ID;
    const header = compact ? 80 : CLASS_HEADER;
    const gapX = compact ? 10 : CHILD_GAP;
    const gapY = compact ? 10 : CHILD_GAP;

    const grid = arrangeGrid(children, CHILD_X, header, gapX, gapY);
    children.forEach((child, index) => {
      const desired = grid.positions[index];
      if (child.position.x !== desired.x || child.position.y !== desired.y) {
        child.position = desired;
        changed = true;
      }
    });

    const width = Math.max(CLASS_WIDTH, grid.right + CHILD_X);
    const height = grid.bottom + CLASS_PAD;
    const style = (parent.style ?? {}) as { width?: number; height?: number };
    if (style.height !== height || style.width !== width) {
      parent.style = { ...style, width, height };
      changed = true;
    }
  }

  const topLevel = next
    .filter(
      (node) =>
        !node.parentId &&
        node.id !== IMPORTS_NODE_ID &&
        node.id !== IMPORTED_BY_NODE_ID
    )
    .sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
    );

  // Keep the import blocks anchored along the top edge; everything else starts
  // below them so they never drift or get overlapped.
  let anchorX = 0;
  let topOffset = 0;
  for (const special of next) {
    if (special.id !== IMPORTS_NODE_ID && special.id !== IMPORTED_BY_NODE_ID) {
      continue;
    }
    if (special.position.x !== anchorX || special.position.y !== 0) {
      special.position = { x: anchorX, y: 0 };
      changed = true;
    }
    const width =
      (special.style as { width?: number } | undefined)?.width ?? TOP_WIDTH;
    anchorX += width + TOP_GAP;
    topOffset = Math.max(topOffset, nodeHeight(special));
  }
  topOffset += TOP_GAP;

  const anyPinned = topLevel.some(
    (node) => (node.data as CodeNodeData).pinned === true
  );
  if (anyPinned) {
    let cursor = topOffset;
    for (const node of topLevel) {
      const pinned = (node.data as CodeNodeData).pinned === true;
      const desiredY = pinned ? Math.max(node.position.y, topOffset) : cursor;
      if (!pinned && (node.position.x !== 0 || node.position.y !== desiredY)) {
        node.position = { x: 0, y: desiredY };
        changed = true;
      }
      cursor = Math.max(cursor, desiredY) + nodeHeight(node) + TOP_GAP;
    }
  } else {
    const grid = arrangeGrid(topLevel, 0, topOffset, TOP_GAP, TOP_GAP);
    topLevel.forEach((node, index) => {
      const desired = grid.positions[index];
      if (node.position.x !== desired.x || node.position.y !== desired.y) {
        node.position = desired;
        changed = true;
      }
    });
  }

  return changed ? next : current;
}

function visibilityOf(id: string, edges: GraphEdge[], selectedId: string | null) {
  const traced = selectedId ? traceNeighbors(edges, selectedId) : null;
  return {
    highlighted: traced ? traced.has(id) : false,
    dimmed: traced ? !traced.has(id) : false,
  };
}

function toFlowNode(node: FlowNode, selectedId: string | null, edges: GraphEdge[]): Node {
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
    data: {
      node: node.data.node,
      color: colorForNode(node.id),
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

    setNodes([
      ...specialFlowNodes(imports),
      ...constantsContainer,
      ...constantChildren,
      ...others.map((node) => toFlowNode(node, null, result.edges)),
    ]);
  }, [result, imports, setNodes]);

  // Re-decorate for trace highlighting without touching positions the user dragged.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: { ...node.data, ...visibilityOf(node.id, result.edges, selectedId) },
      }))
    );
  }, [selectedId, result.edges, setNodes]);

  // Edges are derived from the current node positions so their handles can face
  // the other block (side handles when side by side, top/bottom when stacked).
  const edges: Edge[] = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return result.edges.map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const handles =
        source && target ? pickHandles(source, target, byId) : {};
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
        type: "step",
        ...handles,
        zIndex: active ? 1 : 0,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: active ? 20 : 16,
          height: active ? 20 : 16,
        },
        style: {
          stroke,
          strokeWidth: active ? 5 : 2,
          opacity: unrelated ? 0.12 : 1,
        },
      };
    });
  }, [nodes, result.edges, selectedId]);

  // Re-stack once React Flow has measured real node heights, and again after any
  // resize. Keyed on a height signature so dragging positions never triggers a
  // reflow, and converges because `reflowLayout` returns the same array when
  // nothing needs to move.
  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}`)
    .join("|");
  useEffect(() => {
    setNodes((current) => reflowLayout(current));
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
