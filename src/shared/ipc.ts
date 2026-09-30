import { invoke } from "@tauri-apps/api/core";
import type {
  ImportAnalysis,
  LayoutMap,
  ParseResult,
  ProjectGraph,
} from "./types";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: FileEntry[];
}

export function listDirectory(root: string, relPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_directory", { root, relPath });
}

export function readMarkdown(path: string, root: string): Promise<string> {
  return invoke<string>("read_markdown", { path, root });
}

export function readFile(path: string, root: string): Promise<string> {
  return invoke<string>("read_file", { path, root });
}

export function parsePython(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_python", { path, root });
}

export function parseJsTs(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_js_ts", { path, root });
}

export function analyzeImports(path: string, root: string): Promise<ImportAnalysis> {
  return invoke<ImportAnalysis>("analyze_imports", { path, root });
}

export function projectGraph(root: string, scope: string): Promise<ProjectGraph> {
  return invoke<ProjectGraph>("project_graph", { root, scope });
}

export function loadLayout(root: string, relPath: string): Promise<LayoutMap | null> {
  return invoke<LayoutMap | null>("load_layout", { root, relPath });
}
