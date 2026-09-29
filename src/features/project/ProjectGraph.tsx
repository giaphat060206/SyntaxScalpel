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
import { CodeNode, type CodeNodeData } from "../graph/CodeNode";
import { CLASS_WIDTH, reflowLayout, spreadHandles } from "../graph/layout";
import { EmptyState, ErrorState } from "../../shared/StateViews";

const nodeTypes = { scalpel: CodeNode };

interface Props {
  root: string;
  scope: string;
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

/** Ids hidden because they sit inside a collapsed folder (transitively). */
function hiddenIds(data: ProjectGraphData, collapsed: Set<string>): Set<string> {
  const hidden = new Set<string>();
  for (const folder of data.folders) {
    let parent = folder.parentId;
    while (parent) {
      if (collapsed.has(parent)) {
        hidden.add(folder.id);
        break;
      }
      parent = data.folders.find((f) => f.id === parent)?.parentId;
    }
  }
  for (const file of data.files) {
    if (collapsed.has(file.folderId) || hidden.has(file.folderId)) {
      hidden.add(file.id);
    }
  }
  return hidden;
}

/**
 * Nodes related to the selection, or null when nothing is selected.
 * - a file: itself, the files it imports, the files importing it, and their folders
 * - a folder: the folder, its descendants, and any file connected to one of them
 */
function highlightIds(
  data: ProjectGraphData,
  selectedId: string | null
): Set<string> | null {
  if (!selectedId) {
    return null;
  }
  const set = new Set<string>();
  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]));
  const addFolderChain = (folderId: string) => {
    set.add(folderId);
    let parent = folderById.get(folderId)?.parentId;
    while (parent) {
      set.add(parent);
      parent = folderById.get(parent)?.parentId;
    }
  };
  if (folderById.has(selectedId)) {    set.add(selectedId);
    for (const folder of data.folders) {
      if (folder.id === selectedId || folder.id.startsWith(`${selectedId}/`)) {
        set.add(folder.id);
      }
    }
    const inside = data.files.filter(
      (file) =>
        file.folderId === selectedId ||
        file.folderId.startsWith(`${selectedId}/`)
    );
    const insideIds = new Set(inside.map((file) => file.id));
    for (const file of inside) {
      set.add(file.id);
      addFolderChain(file.folderId);
    }
    for (const file of data.files) {
      if (insideIds.has(file.id)) {
        continue;
      }
      const importsIn = file.imports.some((imp) => insideIds.has(imp.targetId));
      const importedByInside = inside.some((source) =>
        source.imports.some((imp) => imp.targetId === file.id)
      );
      if (importsIn || importedByInside) {
        set.add(file.id);
        addFolderChain(file.folderId);
      }
    }
    return set;
  }

  set.add(selectedId);
  const file = data.files.find((entry) => entry.id === selectedId);
  if (file) {
    addFolderChain(file.folderId);
    for (const imp of file.imports) {
      if (imp.targetId) {
        set.add(imp.targetId);
        const target = data.files.find((entry) => entry.id === imp.targetId);
        if (target) {
          addFolderChain(target.folderId);
        }
      }
    }
    for (const other of data.files) {
      if (other.imports.some((imp) => imp.targetId === selectedId)) {
        set.add(other.id);
        addFolderChain(other.folderId);
      }
    }
  }
  return set;
}

function toNodes(
  data: ProjectGraphData,
  collapsed: Set<string>,
  onToggleCollapse: (id: string) => void
): Node[] {
  const hidden = hiddenIds(data, collapsed);

  const folderNodes: Node[] = data.folders.map((folder) => ({
    id: folder.id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    parentId: folder.parentId,
    extent: folder.parentId ? ("parent" as const) : undefined,
    draggable: false,
    zIndex: 2,
    hidden: hidden.has(folder.id),
    style: { width: folder.parentId ? undefined : CLASS_WIDTH },
    data: {
      project: {
        kind: "folder",
        name: folder.name,
        collapsed: collapsed.has(folder.id),
      },
      color: colorForNode(folder.id),
      onToggleCollapse,
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  }));

  const fileNodes: Node[] = data.files.map((file) => ({
    id: file.id,
    type: "scalpel",
    position: { x: 0, y: 0 },
    parentId: file.folderId,
    extent: "parent" as const,
    draggable: false,
    zIndex: 2,
    hidden: hidden.has(file.id),
    style: { width: 180 },
    data: {
      project: { kind: "file", name: file.name, imports: file.imports },
      color: colorForNode(file.id),
      highlighted: false,
      dimmed: false,
    } satisfies CodeNodeData,
  }));

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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { fitView } = useReactFlow();
  const lastFit = useRef<string>("");

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

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback(
    (event: ReactMouseEvent | globalThis.MouseEvent) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleRealign = useCallback(() => {
    if (data) {
      setNodes(toNodes(data, collapsed, toggleCollapse));
    }
    window.setTimeout(() => fitView({ padding: 0.2 }), 80);
    setMenu(null);
  }, [data, collapsed, toggleCollapse, setNodes, fitView]);

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
    const highlight = highlightIds(data, selectedId);
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

  const sizeSignature = nodes
    .map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}:${node.hidden ? 1 : 0}`)
    .join("|");
  useEffect(() => {
    setNodes((current) => reflowLayout(current));
  }, [sizeSignature, setNodes]);

  const fitToken = `${root}|${scope}`;
  useEffect(() => {
    if (!data || lastFit.current === fitToken) {
      return;
    }
    const timer = window.setTimeout(() => {
      lastFit.current = fitToken;
      fitView({ padding: 0.2 });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fitToken, sizeSignature, data, fitView]);

  const edges: Edge[] = useMemo(() => {
    if (!data) {
      return [];
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const highlight = highlightIds(data, selectedId);
    const outCount = new Map<string, number>();
    const inCount = new Map<string, number>();
    return data.edges
      .filter((edge) => {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        return source && target && !source.hidden && !target.hidden;
      })
      .map((edge, edgeIndex) => {
        const source = byId.get(edge.source)!;
        const target = byId.get(edge.target)!;
        const sourceIndex = outCount.get(edge.source) ?? 0;
        const targetIndex = inCount.get(edge.target) ?? 0;
        outCount.set(edge.source, sourceIndex + 1);
        inCount.set(edge.target, targetIndex + 1);
        const related = highlight
          ? highlight.has(edge.source) && highlight.has(edge.target)
          : false;
        const unrelated = highlight !== null && !related;
        const touchesSelection =
          selectedId !== null &&
          (edge.source === selectedId || edge.target === selectedId);
        const stroke =
          (source.data as CodeNodeData).color ?? "#00F0FF";
        return {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          pathOptions: { borderRadius: 14, offset: 24 + (edgeIndex % 4) * 16 },
          ...spreadHandles(source, target, byId, sourceIndex, targetIndex),
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
            opacity: unrelated ? 0.12 : touchesSelection || related ? 1 : 0.7,
          },
        };
      });
  }, [data, nodes, selectedId]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedId(
        data?.folders.some((folder) => folder.id === node.id) ? null : node.id
      );
    },
    [data]
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
    <div className="relative h-full bg-bg" onContextMenu={(event) => event.preventDefault()}>
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
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => setSelectedId(null)}
        onPaneContextMenu={openMenu}
        onNodeContextMenu={openMenu}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2A3138" gap={20} />
        <Controls />
      </ReactFlow>

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
                className="break-words font-mono text-white/85"
              >
                {entry.targetId || entry.specifier}
                {entry.names.length > 0 ? `: ${entry.names.join(", ")}` : ""}
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
              <div key={importer.path} className="break-words font-mono text-white/85">
                {importer.path}
                {importer.names.length > 0 ? `: ${importer.names.join(", ")}` : ""}
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
