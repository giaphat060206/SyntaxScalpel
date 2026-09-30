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
import type { ProjectGraph as ProjectGraphData } from "../../shared/types";
import { projectGraph } from "../../shared/ipc";
import { colorForNode } from "../graph/colors";
import { hiddenIds, selectionInfo } from "./selection";
import { CodeNode, type CodeNodeData } from "../graph/CodeNode";
import { CLASS_WIDTH, reflowLayout } from "../graph/layout";
import { runElkLayout } from "../graph/elk/layout";
import { ElkEdge } from "../graph/elk/ElkEdge";
import { EmptyState, ErrorState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };
const edgeTypes = { elk: ElkEdge };

interface Props {
  root: string;
  scope: string;
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

function toNodes(
  data: ProjectGraphData,
  collapsed: Set<string>,
  onToggleCollapse: (id: string) => void
): Node[] {
  const hidden = hiddenIds(data, collapsed);

  // Folders that contain at least one edge endpoint stay transparent so their
  // lines remain visible; folders merely passed by stay opaque. The scope root
  // itself is NOT rendered as a container: it encloses the whole canvas, so it
  // would either hide every line or show every line through it. Its children
  // become top-level nodes and the breadcrumb shows the location instead.
  const transparentFolders = new Set<string>();
  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]));
  for (const edge of data.edges) {
    for (const id of [edge.source, edge.target]) {
      const file = data.files.find((entry) => entry.id === id);
      let folder = file?.folderId;
      while (folder) {
        transparentFolders.add(folder);
        folder = folderById.get(folder)?.parentId;
      }
    }
  }

  const folderNodes: Node[] = data.folders
    .filter((folder) => folder.id !== data.root)
    .map((folder) => ({
      id: folder.id,
      type: "scalpel",
      position: { x: 0, y: 0 },
      parentId: folder.parentId === data.root ? undefined : folder.parentId,
      extent: folder.parentId && folder.parentId !== data.root ? ("parent" as const) : undefined,
      draggable: false,
      zIndex: 1,
      hidden: hidden.has(folder.id),
      style: { width: folder.parentId ? undefined : CLASS_WIDTH },
      data: {
        project: {
          kind: "folder",
          name: folder.name,
          collapsed: collapsed.has(folder.id),
          transparent: transparentFolders.has(folder.id),
        },
        color: colorForNode(folder.id),
        onToggleCollapse,
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    }));

  const entryList = data?.entries?.length
    ? data.entries
    : data?.entry
      ? [data.entry]
      : [];

  const fileNodes: Node[] = data.files.map((file) => {
    const isTopLevel = file.folderId === data.root;
    return {
      id: file.id,
      type: "scalpel",
      position: { x: 0, y: 0 },
      parentId: isTopLevel ? undefined : file.folderId,
      extent: isTopLevel ? undefined : ("parent" as const),
      draggable: false,
      zIndex: 4,
      hidden: hidden.has(file.id),
      style: { width: 180 },
      data: {
        project: {
          kind: "file",
          name: file.name,
          imports: file.imports,
          fileKind: file.kind,
          entry: entryList.includes(file.id),
          external: file.external === true,
        },
        // Docs/config get a muted colour; entry files get the mint accent;
        // out-of-scope targets stay grey so they read as external.
        color: entryList.includes(file.id)
          ? "#3DF0A8"
          : file.kind === "doc" || file.external
            ? "#8A93A0"
            : colorForNode(file.id),
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    };
  });

  return [...folderNodes, ...fileNodes];
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
  const [showLines, setShowLines] = useState(true);
  const [startsOpen, setStartsOpen] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [sections, setSections] = useState<Record<string, { x: number; y: number }[]>>({});
  const [layoutRun, setLayoutRun] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { fitView, getInternalNode, setCenter } = useReactFlow();
  const lastFit = useRef<string>("");
  const lastLayoutKey = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setCollapsed(new Set());
    setSelectedId(null);
    setSections({});
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

  // Build the nodes once per loaded graph.
  useEffect(() => {
    if (!data) {
      return;
    }
    setSections({});
    setNodes(toNodes(data, new Set(), toggleCollapse));
  }, [data, toggleCollapse, setNodes]);

  // Collapse only flips `hidden` flags (and the folder glyph) on the existing
  // nodes, preserving positions and measurements so the graph does not jump or
  // fully re-layout on every toggle.
  useEffect(() => {
    if (!data) {
      return;
    }
    const hidden = hiddenIds(data, collapsed);
    const highlight = selectionInfo(data, selectedId)?.highlight ?? null;
    setNodes((current) =>
      current.map((node) => {
        const shouldHide = hidden.has(node.id);
        const isFolder = Boolean((node.data as CodeNodeData).project?.kind === "folder");
        const collapsedFlag = collapsed.has(node.id);
        const currentFlag = (node.data as CodeNodeData).project?.collapsed;
        const dimmed = highlight ? !highlight.has(node.id) : false;
        const highlighted = highlight ? node.id === selectedId : false;
        const data_ = node.data as CodeNodeData;
        if (
          node.hidden === shouldHide &&
          data_.dimmed === dimmed &&
          data_.highlighted === highlighted &&
          (!isFolder || currentFlag === collapsedFlag)
        ) {
          return node;
        }
        return {
          ...node,
          hidden: shouldHide,
          data: {
            ...node.data,
            dimmed,
            highlighted,
            project: isFolder
              ? {
                  ...(node.data as CodeNodeData).project,
                  collapsed: collapsedFlag,
                }
              : (node.data as CodeNodeData).project,
          },
        };
      })
    );
  }, [data, collapsed, selectedId, setNodes]);

  // Edges are routed by ELK from the section points it computed, falling back to
  // a smooth step in `ElkEdge` until a section exists. Idle edges are faded.
  const edges: Edge[] = useMemo(() => {
    if (!data) {
      return [];
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const selection = selectionInfo(data, selectedId);
    const focus = selection?.focus ?? null;
    return data.edges
      .filter((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return source && target && !source.hidden && !target.hidden;
      })
      .map((edge) => {
        const id = `${edge.source}->${edge.target}`;
        const source = byId.get(edge.source)!;
        // Only edges that touch the focused files stay bright; an edge between
        // two merely-highlighted files (e.g. two imports of the selection) dims.
        const focused = focus
          ? focus.has(edge.source) || focus.has(edge.target)
          : false;
        const unrelated = focus !== null && !focused;
        const stroke = (source.data as CodeNodeData).color ?? "#00F0FF";
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
            opacity: unrelated ? 0.12 : focused ? 1 : showLines ? 0.7 : 0,
          },
        };
      });
  }, [data, nodes, selectedId, showLines, sections]);

  const edgesForLayout = edges;

  // ELK owns placement: run it once the measured sizes settle, and again after a
  // Re-align or a collapse/scope change. On any failure (or above the node cap)
  // fall back to the old grid.
  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}:${node.hidden ? 1 : 0}`)
    .join("|");
  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
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
      const key = `${scope}|${layoutRun}|${sizeSignature}|${collapsed.size}`;
      if (lastLayoutKey.current === key) {
        return;
      }
      lastLayoutKey.current = key;
      setSections(result.sections);
      setLayoutVersion((value) => value + 1);
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
            ...(size ? { style: { ...(node.style ?? {}), ...size } } : {}),
          };
        })
      );
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sizeSignature, layoutRun, collapsed, data, setNodes]);

  // Centre the viewport on one block at a given zoom. Uses React Flow's computed
  // absolute position + measured size (handles nested folders), and reports
  // false until the block has actually been measured.
  const centerOn = useCallback(
    (id: string, zoom: number, duration: number) => {
      const internals = getInternalNode(id);
      if (!internals) {
        return false;
      }
      const { positionAbsolute, userNode } = internals.internals;
      const width = userNode.measured?.width ?? 0;
      const height = userNode.measured?.height ?? 0;
      if (width === 0 || height === 0) {
        return false;
      }
      setCenter(
        positionAbsolute.x + width / 2,
        positionAbsolute.y + height / 2,
        { zoom, duration }
      );
      return true;
    },
    [getInternalNode, setCenter]
  );

  // First view of a scope: snap the viewport onto the start file once its block
  // has been measured. No animation here, and no `fitView` prop, so nothing
  // competes with the reflow that is still settling.
  const fitToken = `${root}|${scope}|${layoutVersion}`;
  useEffect(() => {
    if (!data || nodes.length === 0 || lastFit.current === fitToken) {
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      // Wait a beat so the first coalesced reflow has settled the positions.
      const focused =
        data.entry && attempts >= 2 ? centerOn(data.entry, 1.1, 0) : false;
      if (focused) {
        lastFit.current = fitToken;
        window.clearInterval(timer);
      } else if (attempts >= 40) {
        lastFit.current = fitToken;
        fitView({ padding: 0.2, duration: 0 });
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [fitToken, sizeSignature, data, nodes.length, centerOn, fitView]);;

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedId(node.id);
  }, []);

  // Centre the viewport on an entry-point block (used by the Start chip).
  const focusEntry = useCallback(
    (id: string) => {
      setSelectedId(id);
      centerOn(id, 1.2, 400);
    },
    [centerOn]
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

  const selectedFile =
    data && selectedId
      ? data.files.find((file) => file.id === selectedId)
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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => setSelectedId(null)}
        onPaneContextMenu={openMenu}
        onNodeContextMenu={openMenu}
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
