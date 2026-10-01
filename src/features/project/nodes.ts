import type { Node } from "@xyflow/react";
import type { ProjectGraph } from "../../shared/types";
import { colorForNode } from "../graph/colors";
import { CLASS_WIDTH } from "../graph/layout";
import { type CodeNodeData } from "../graph/CodeNode";
import { hiddenIds, selectionInfo } from "./selection";
import { folderChain } from "./folderChain";

export { folderChain };

export function buildProjectNodes(
  data: ProjectGraph,
  _collapsed: Set<string>,
  onToggleCollapse: (id: string) => void
): Node[] {
  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]));

  const transparentFolders = new Set<string>();
  for (const edge of data.edges) {
    for (const id of [edge.source, edge.target]) {
      const file = data.files.find((entry) => entry.id === id);
      if (!file) {
        continue;
      }
      for (const folderId of folderChain(file.folderId, folderById)) {
        transparentFolders.add(folderId);
      }
    }
  }

  const entryList = data.entries?.length
    ? data.entries
    : data.entry
      ? [data.entry]
      : [];

  const folderNodes: Node[] = data.folders
    .filter((folder) => folder.id !== data.root)
    .map((folder) => ({
      id: folder.id,
      type: "scalpel",
      position: { x: 0, y: 0 },
      parentId: folder.parentId === data.root ? undefined : folder.parentId,
      extent:
        folder.parentId && folder.parentId !== data.root
          ? ("parent" as const)
          : undefined,
      draggable: false,
      zIndex: 1,
      style: { width: folder.parentId ? undefined : CLASS_WIDTH },
      data: {
        project: {
          kind: "folder",
          name: folder.name,
          transparent: transparentFolders.has(folder.id),
        },
        color: colorForNode(folder.id),
        onToggleCollapse,
        highlighted: false,
        dimmed: false,
      } satisfies CodeNodeData,
    }));

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

export function decorateProjectNodes(
  nodes: Node[],
  data: ProjectGraph,
  collapsed: Set<string>,
  selectedId: string | null
): Node[] {
  const hidden = hiddenIds(data, collapsed);
  const highlight = selectionInfo(data, selectedId)?.highlight ?? null;
  return nodes.map((node) => {
    const nodeData = node.data as CodeNodeData;
    return {
      ...node,
      hidden: hidden.has(node.id),
      data: {
        ...nodeData,
        project: nodeData.project
          ? { ...nodeData.project, collapsed: collapsed.has(node.id) }
          : nodeData.project,
        highlighted: highlight ? node.id === selectedId : false,
        dimmed: highlight ? !highlight.has(node.id) : false,
      },
    };
  });
}
