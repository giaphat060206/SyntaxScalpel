import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProjectGraph as ProjectGraphData } from "../../shared/types";
import { projectGraph } from "../../shared/ipc";
import { selectionInfo } from "./selection";
import { buildProjectNodes, decorateProjectNodes } from "./nodes";
import { CodeNode } from "../graph/CodeNode";
import { ElkEdge } from "../graph/elk/ElkEdge";
import { EmptyState, ErrorState } from "../../shared/StateViews";
import {
  useSearchRegistration,
  type SearchItem,
} from "../shell/SearchContext";
import { GraphSearch } from "../graph/GraphSearch";
import {
  useGraphCanvas,
  type DomainEdge,
  type EdgeVisibility,
} from "../graph/canvas/useGraphCanvas";

const nodeTypes = { scalpel: CodeNode };
const edgeTypes = { elk: ElkEdge };

interface Props {
  root: string;
  scope: string;
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

export function ProjectGraph({ root, scope, onNavigate }: Props) {
  return (
    <ReactFlowProvider>
      <ProjectGraphInner root={root} scope={scope} onNavigate={onNavigate} />
    </ReactFlowProvider>
  );
}

function ProjectGraphInner({ root, scope, onNavigate }: Props) {
  const [data, setData] = useState<ProjectGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startsOpen, setStartsOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setCollapsed(new Set());
    setSelectedId(null);
    projectGraph(root, scope)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [root, scope]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Ignore a selection that is not on the canvas (stale id) so the graph does
  // not dim entirely.
  const activeSelectedId = useMemo(() => {
    if (!selectedId || !data) {
      return null;
    }
    return data.folders.some((folder) => folder.id === selectedId) ||
      data.files.some((file) => file.id === selectedId)
      ? selectedId
      : null;
  }, [selectedId, data]);

  // Build the nodes once per loaded graph, then decorate with collapse and
  // selection state in one stable array. Positions and measurements are merged
  // by the canvas, so a collapse only flips `hidden`/glyph and never jumps.
  const decoratedNodes = useMemo<Node[]>(() => {
    if (!data) {
      return [];
    }
    return decorateProjectNodes(
      buildProjectNodes(data, collapsed, toggleCollapse),
      data,
      collapsed,
      activeSelectedId
    );
  }, [data, collapsed, activeSelectedId, toggleCollapse]);

  // Project edges carry no id; the canvas speaks in `DomainEdge`s.
  const domainEdges = useMemo<DomainEdge[]>(
    () =>
      (data?.edges ?? []).map((edge) => ({
        ...edge,
        id: `${edge.source}->${edge.target}`,
      })),
    [data]
  );

  // Only edges that touch the focused files stay bright; an edge between two
  // merely-highlighted files (e.g. two imports of the selection) dims.
  const handleEdgeVisibility = useCallback(
    (edge: DomainEdge, selected: unknown): EdgeVisibility => {
      if (typeof selected !== "string" || !data) {
        return "active";
      }
      const focus = selectionInfo(data, selected)?.focus ?? null;
      if (!focus) {
        return "active";
      }
      return focus.has(edge.source) || focus.has(edge.target)
        ? "active"
        : "dim";
    },
    [data]
  );

  const canvas = useGraphCanvas({
    nodes: decoratedNodes,
    edges: domainEdges,
    selection: activeSelectedId,
    layoutKey: `${scope}|${collapsed.size}`,
    fit: { token: `${root}|${scope}`, target: data?.entry ?? undefined },
    edgeVisibility: handleEdgeVisibility,
  });

  // Centre the viewport on an entry-point block (used by the Start chip).
  const focusEntry = useCallback(
    (id: string) => {
      setSelectedId(id);
      canvas.centerOn(id, 1.2, 400);
    },
    [canvas.centerOn]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!data || node.id === data.root) {
        return;
      }
      const kind = data?.folders.some((folder) => folder.id === node.id)
        ? "folder"
        : "code";
      onNavigate({ kind, path: node.id });
    },
    [data, onNavigate]
  );

  // Entry points detected by the backend (conventions, then graph roots).
  const entryList = data?.entries?.length
    ? data.entries
    : data?.entry
      ? [data.entry]
      : [];

  // Show entry paths relative to the folder the user is looking at, so a deep
  // start file reads `folder3/startFile` instead of the whole project path.
  const shortPath = (path: string) =>
    scope && path.startsWith(`${scope}/`) ? path.slice(scope.length + 1) : path;

  // Searchable folders and files for the Ctrl+F search box.
  const searchItems = useMemo<SearchItem[]>(() => {
    if (!data) {
      return [];
    }
    const folders: SearchItem[] = data.folders
      .filter((folder) => folder.id !== data.root)
      .map((folder) => ({
        id: folder.id,
        label: scope && folder.id.startsWith(`${scope}/`)
          ? folder.id.slice(scope.length + 1)
          : folder.id,
        hint: "folder",
      }));
    const files: SearchItem[] = data.files.map((file) => ({
      id: file.id,
      label:
        scope && file.id.startsWith(`${scope}/`)
          ? file.id.slice(scope.length + 1)
          : file.id,
      hint: file.external ? "ext" : file.kind,
    }));
    return [...folders, ...files];
  }, [data, scope]);

  // Picking from the explorer's search navigates straight to that folder's or
  // file's graph.
  useSearchRegistration(searchItems, (id) => {
    if (id === data?.root) {
      return;
    }
    const kind = data?.folders.some((folder) => folder.id === id)
      ? "folder"
      : "code";
    onNavigate({ kind, path: id });
  });

  // Picking from the panel's own search box centres the view on the block.
  const handlePanelSearchPick = useCallback(
    (id: string) => {
      setSelectedId(id);
      canvas.centerOn(id, 1.2, 400);
    },
    [canvas.centerOn]
  );

  const handleOpenFromMenu = useCallback(() => {
    const nodeId = canvas.menuNodeId;
    if (!nodeId || nodeId === data?.root) {
      canvas.closeMenu();
      return;
    }
    const kind = data?.folders.some((folder) => folder.id === nodeId)
      ? "folder"
      : "code";
    onNavigate({ kind, path: nodeId });
    canvas.closeMenu();
  }, [canvas.menuNodeId, canvas.closeMenu, data, onNavigate]);

  const selectedFile =
    data && activeSelectedId
      ? data.files.find((file) => file.id === activeSelectedId)
      : undefined;

  // Files that import the selected file, with the symbols they pull from it.
  const importers =
    data && selectedFile
      ? data.files
          .map((file) => ({
            path: file.id,
            names: file.imports
              .filter((imp) => imp.targetId === selectedFile.id)
              .flatMap((imp) => imp.names),
          }))
          .filter((entry) => entry.path !== selectedFile.id && entry.names.length > 0)
      : [];

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!data) {
    return <EmptyState message="Loading project…" />;
  }
  if (data.files.length === 0) {
    return <EmptyState message="No source files in this folder" />;
  }

  return (
    <div
className="relative h-full bg-bg"
      onContextMenu={(event) => event.preventDefault()}
    >
      <GraphSearch
        items={searchItems}
        onPick={handlePanelSearchPick}
        placeholder="Search files and folders…"
      />

      {entryList.length > 0 && (
        <div className="absolute left-3 top-3 z-10 max-h-[45%] w-64 overflow-auto rounded border border-mint/40 bg-panel text-xs text-mint">
          <button
            type="button"
            onClick={() => setStartsOpen((value) => !value)}
            className="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-mint/10"
          >
            <span>
              {entryList.length === 1 ? "Start" : `Starts (${entryList.length})`}
            </span>
            <span className="text-mint/80">{startsOpen ? "▾" : "▸"}</span>
          </button>
          {startsOpen && (
            <ul className="m-0 list-none p-0 px-2 pb-1">
              {entryList.map((id) => (
                <li key={id} className="flex items-start gap-1">
                  <span className="shrink-0 text-mint/70">•</span>
                  <button
                    type="button"
                    onClick={() => focusEntry(id)}
                    title={id}
                    className="min-w-0 flex-1 truncate text-left underline underline-offset-2 hover:text-white"
                  >
                    {shortPath(id)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {data.truncated && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded border border-yellow-500/40 bg-panel px-3 py-1 text-xs text-yellow-300">
          Large project: only the first 2000 files are shown
        </div>
      )}
      <ReactFlow
        nodes={canvas.nodes}
        edges={canvas.edges}
        onNodesChange={canvas.onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_event, node) => setSelectedId(node.id)}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => {
          canvas.closeMenu();
          setSelectedId(null);
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

      {selectedFile && (
        <div className="absolute right-3 top-3 z-20 max-h-[60%] w-80 overflow-auto rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
          <div className="break-words font-mono text-sm text-accent">
            {selectedFile.name}
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Imports
          </div>
          {selectedFile.imports.length === 0 ? (
            <div className="font-mono text-white/80">none</div>
          ) : (
            selectedFile.imports.map((entry) => (
              <div
                key={`${entry.targetId}|${entry.specifier}|${entry.names.join(",")}`}
                className="flex items-start gap-1 font-mono text-white/85"
              >
                <span className="shrink-0 text-accent/60">•</span>
                <span className="min-w-0 break-words">
                  {entry.targetId || entry.specifier}
                  {entry.names.length > 0 ? `: ${entry.names.join(", ")}` : ""}
                </span>
              </div>
            ))
          )}
          <div className="mt-2 text-[10px] uppercase tracking-wider text-dimmed">
            Imported by
          </div>
          {importers.length === 0 ? (
            <div className="font-mono text-white/80">none</div>
          ) : (
            importers.map((importer) => (
              <div
                key={importer.path}
                className="flex items-start gap-1 font-mono text-white/85"
              >
                <span className="shrink-0 text-mint/60">•</span>
                <span className="min-w-0 break-words">
                  {importer.path}
                  {importer.names.length > 0 ? `: ${importer.names.join(", ")}` : ""}
                </span>
              </div>
            ))
          )}
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
            {canvas.menuNodeId && canvas.menuNodeId !== data.root && (
              <button
                type="button"
                onClick={handleOpenFromMenu}
                className="block w-full px-3 py-1.5 text-left text-xs text-mint hover:bg-mint/10"
              >
                {data.folders.some((folder) => folder.id === canvas.menuNodeId)
                  ? "Open folder graph"
                  : "Open file graph"}
              </button>
            )}
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
