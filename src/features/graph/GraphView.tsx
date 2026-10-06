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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FunctionGraph } from "../../shared/types";
import { buildFunctionNodes, crossFileNodeIdForName, crossFileNodeIdForPath, decorateFunctionNodes } from "./nodes";
import { emphasisVisibility, useEmphasis } from "./emphasis";
import { CodeNode, type CodeNodeData } from "./CodeNode";
import { useSearchRegistration, type SearchItem } from "../shell/SearchContext";
import { GraphSearch } from "./GraphSearch";
import { ElkEdge } from "./elk/ElkEdge";
import { EmptyState } from "../../shared/StateViews";
import {
  useGraphCanvas,
  type DomainEdge,
  type EdgeVisibility,
} from "./canvas/useGraphCanvas";

const nodeTypes = { scalpel: CodeNode };
const edgeTypes = { elk: ElkEdge };

interface Props {
  graph: FunctionGraph;
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

function GraphViewInner({ graph, selectedId, onSelect }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const builtNodes = useMemo(() => buildFunctionNodes(graph), [graph]);

  // A selection that does not match any node on the canvas (stale id from a
  // previous file) must not dim the whole graph.
  const activeSelectedId = useMemo(
    () =>
      selectedId !== null && builtNodes.some((node) => node.id === selectedId)
        ? selectedId
        : null,
    [selectedId, builtNodes]
  );

  const allEdges = useMemo(
    () => [...graph.file.edges, ...graph.crossEdges],
    [graph]
  );

  const { emphasis, setEmphasis } = useEmphasis();
  const emphasisIds = emphasis?.ids ?? [];

  const decoratedNodes = useMemo(
    () => decorateFunctionNodes(builtNodes, allEdges, activeSelectedId, emphasisIds),
    [builtNodes, allEdges, activeSelectedId, emphasis]
  );

  const domainEdges = useMemo<DomainEdge[]>(
    () =>
      allEdges.map((edge) => ({
        ...edge,
        id: `${edge.source}->${edge.target}`,
      })),
    [allEdges]
  );

  const handleEdgeVisibility = useCallback(
    (edge: DomainEdge, selected: unknown): EdgeVisibility =>
      emphasisVisibility(edge, emphasis, () => {
        if (typeof selected !== "string") return "active";
        return edge.source === selected || edge.target === selected ? "active" : "dim";
      }),
    [emphasis]
  );

  // External blocks belong in the key: a new neighbourhood is a new graph.
  const layoutKey = `${graph.file.filePath}|${graph.externals.length}|${graph.crossEdges.length}`;

  const canvas = useGraphCanvas({
    nodes: decoratedNodes,
    edges: domainEdges,
    selection: activeSelectedId,
    layoutKey,
    fit: { token: layoutKey },
    edgeVisibility: handleEdgeVisibility,
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
      if (!canvas.zoomToNode(id)) {
        canvas.fitView();
      }
    },
    [onSelect, canvas.fitView, canvas.zoomToNode]
  );

  // The explorer's search picks the same way (a function cannot be "opened").
  useSearchRegistration(searchItems, handleSearchPick);

  if (graph.file.nodes.length === 0) {
    return <EmptyState message="No functions detected" />;
  }

  const activeId = activeSelectedId ?? hoveredId;

  // A row in the info card names a counterpart the canvas may draw, so hovering
  // it lights up the two ends and the arrow between them.
  const emphasiseWith = useCallback(
    (counterpart: string) => ({
      onMouseEnter: () =>
        setEmphasis({ ids: activeId ? [activeId, counterpart] : [counterpart] }),
      onMouseLeave: () => setEmphasis(null),
    }),
    [activeId, setEmphasis]
  );
  const activeNode = activeId
    ? canvas.nodes.find((node) => node.id === activeId)
    : undefined;
  const activeGraph = activeNode
    ? (activeNode.data as CodeNodeData).node
    : undefined;
  const activeUses = activeGraph?.uses ?? [];
  const activeImporters = activeGraph
    ? graph.imports.importedBy.filter((entry) =>
        entry.names.includes(activeGraph.name)
      )
    : [];
  const moduleImporters = activeGraph
    ? graph.imports.importedBy.filter((entry) => entry.names.length === 0)
    : [];

  return (
    <div
      className="relative h-full bg-bg"
      // Suppress WebView2's native context menu everywhere in the canvas (including
      // on our own menu), so only the custom menu below ever shows.
      onContextMenu={(event) => event.preventDefault()}
    >
      {(graph.file.nodes.length > 5000 || graph.truncated) && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
          {graph.file.nodes.length > 5000 && (
            <div className="rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
              Large file: {graph.file.nodes.length} nodes — performance may degrade
            </div>
          )}
          {graph.truncated && (
            <div className="rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
              Some cross-file definitions were left out of this graph
            </div>
          )}
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
        // React Flow passes no event for its own programmatic moves, so a real
        // one means the user took over the viewport.
        onMoveStart={(event) => {
          if (event) {
            canvas.noteManualMove();
          }
        }}
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
            {activeUses.length > 0 ? (
              activeUses.map((name, index) => {
                // A name a dashed block shows can be jumped to; the rest is text.
                const target = crossFileNodeIdForName(canvas.nodes, name);
                return (
                  <span key={name}>
                    {index > 0 && ", "}
                    {target ? (
                      <button
                        type="button"
                        title={`Go to ${target}`}
                        onClick={() => canvas.focusNode(target)}
                        {...emphasiseWith(target)}
                        className="text-accent hover:underline"
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )}
                  </span>
                );
              })
            ) : (
              "none"
            )}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Imported by
          </div>
          <div className="font-mono text-white/85">
            {activeImporters.length === 0 && moduleImporters.length === 0 ? (
              <div>none</div>
            ) : (
              <>
                {activeImporters.map((entry) => {
                  const target = crossFileNodeIdForPath(canvas.nodes, entry.path);
                  return (
                    <div key={entry.path} className="break-words">
                      {target ? (
                        <button
                          type="button"
                          title={`Go to ${target}`}
                          onClick={() => canvas.focusNode(target)}
                          {...emphasiseWith(target)}
                          className="text-accent hover:underline"
                        >
                          {entry.path}
                        </button>
                      ) : (
                        entry.path
                      )}
                      :{" "}
                      {entry.names
                        .filter((name) => name === activeGraph.name)
                        .join(", ")}
                    </div>
                  );
                })}
                {moduleImporters.map((entry) => {
                  const target = crossFileNodeIdForPath(canvas.nodes, entry.path);
                  return (
                    <div key={entry.path} className="break-words text-white/60">
                      {target ? (
                        <button
                          type="button"
                          title={`Go to ${target}`}
                          onClick={() => canvas.focusNode(target)}
                          {...emphasiseWith(target)}
                          className="text-accent hover:underline"
                        >
                          {entry.path}
                        </button>
                      ) : (
                        entry.path
                      )}{" "}
                      (module)
                    </div>
                  );
                })}
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
