import { invoke } from "@tauri-apps/api/core";
import type { LayoutMap, ParseResult } from "./types";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: FileEntry[];
}

export function listDirectory(root: string, relPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", { root, relPath });
}

export function readMarkdown(path: string): Promise<string> {
  return invoke<string>("read_markdown", { path });
}

export function parsePython(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_python", { path, root });
}

export function parseJsTs(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_js_ts", { path, root });
}

export function loadLayout(root: string, relPath: string): Promise<LayoutMap | null> {
  return invoke<LayoutMap | null>("load_layout", { root, relPath });
}

export function saveLayout(
  root: string,
  relPath: string,
  layout: LayoutMap
): Promise<void> {
  return invoke<void>("save_layout", { root, relPath, layout });
}
