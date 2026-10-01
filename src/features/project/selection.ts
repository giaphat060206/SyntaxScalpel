import type { ProjectGraph } from "../../shared/types";
import { folderChain } from "./folderChain";

/** Ids hidden because they sit inside a collapsed folder (transitively). */
export function hiddenIds(
  data: ProjectGraph,
  collapsed: Set<string>
): Set<string> {
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

export interface SelectionInfo {
  /** Nodes kept bright. */
  highlight: Set<string>;
  /** Files whose direct edges stay bright (the focus of the selection). */
  focus: Set<string>;
}

/**
 * What a selection highlights, or null when nothing is selected.
 * - a file: itself, the files it directly imports, the files directly importing
 *   it, and the folders holding them. No transitive relations.
 * - a folder: the folder, its descendants, and files directly connected to a
 *   file inside it.
 * `focus` is the set of files that may keep their edges bright; an edge between
 * two highlighted-but-not-focused files is dimmed, so a focus on file1 shows
 * file1↔file2 but not file2↔file3.
 */
export function selectionInfo(
  data: ProjectGraph,
  selectedId: string | null
): SelectionInfo | null {
  if (!selectedId) {
    return null;
  }
  const highlight = new Set<string>();
  const focus = new Set<string>();
  const folderById = new Map(data.folders.map((folder) => [folder.id, folder]));
  const addFolderChain = (folderId: string) => {
    for (const id of folderChain(folderId, folderById)) {
      highlight.add(id);
    }
  };

  if (folderById.has(selectedId)) {
    highlight.add(selectedId);
    for (const folder of data.folders) {
      if (folder.id === selectedId || folder.id.startsWith(`${selectedId}/`)) {
        highlight.add(folder.id);
      }
    }
    const inside = data.files.filter(
      (file) =>
        file.folderId === selectedId ||
        file.folderId.startsWith(`${selectedId}/`)
    );
    const insideIds = new Set(inside.map((file) => file.id));
    for (const file of inside) {
      highlight.add(file.id);
      focus.add(file.id);
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
        highlight.add(file.id);
        addFolderChain(file.folderId);
      }
    }
    return { highlight, focus };
  }

  highlight.add(selectedId);
  focus.add(selectedId);
  const file = data.files.find((entry) => entry.id === selectedId);
  if (file) {
    addFolderChain(file.folderId);
    for (const imp of file.imports) {
      if (imp.targetId) {
        highlight.add(imp.targetId);
        const target = data.files.find((entry) => entry.id === imp.targetId);
        if (target) {
          addFolderChain(target.folderId);
        }
      }
    }
    for (const other of data.files) {
      if (other.imports.some((imp) => imp.targetId === selectedId)) {
        highlight.add(other.id);
        addFolderChain(other.folderId);
      }
    }
  }
  return { highlight, focus };
}
