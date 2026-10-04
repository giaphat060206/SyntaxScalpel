import { invoke } from "@tauri-apps/api/core";
import type {
  ApiInventory,
  FunctionGraph,
  ImportAnalysis,
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

export function parseRust(path: string, root: string): Promise<ParseResult> {
  return invoke<ParseResult>("parse_rust", { path, root });
}

/** One file's Function Graph plus the cross-file Definitions it reaches, and the
 *  Import Analysis, from a single project scan. */
export function functionGraph(path: string, root: string): Promise<FunctionGraph> {
  return invoke<FunctionGraph>("function_graph", { path, root });
}

export function analyzeImports(path: string, root: string): Promise<ImportAnalysis> {
  return invoke<ImportAnalysis>("analyze_imports", { path, root });
}

export function projectGraph(root: string, scope: string): Promise<ProjectGraph> {
  return invoke<ProjectGraph>("project_graph", { root, scope });
}

export function analyzeApi(root: string): Promise<ApiInventory> {
  return invoke<ApiInventory>("analyze_api", { root });
}

export interface AiSettings {
  provider: string;
  hasKey: boolean;
}

export interface AiSummary {
  /** Content-addressed key, so an export reads the stored document. */
  key: string;
  text: string;
  task: string;
  provider: string;
  model: string;
  cached: boolean;
  truncated: boolean;
  createdAtMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type AiTarget =
  | { kind: "scope"; scope: string }
  | { kind: "files"; scope: string; files: string[] }
  | { kind: "definitions"; file: string; ids: string[] };

export interface AiRequest {
  root: string;
  target: AiTarget;
  task: string;
  provider: string;
  model: string;
  force?: boolean;
}

/** Whether a Provider Key is held for this provider. The key itself never
 *  crosses back: only Rust reads it, and only to build an authorization header. */
export function aiSettings(provider: string): Promise<AiSettings> {
  return invoke<AiSettings>("ai_settings", { provider });
}

export function setAiKey(provider: string, key: string): Promise<AiSettings> {
  return invoke<AiSettings>("set_ai_key", { provider, key });
}

export function clearAiKey(provider: string): Promise<AiSettings> {
  return invoke<AiSettings>("clear_ai_key", { provider });
}

/** Which Digest layers a task pays for is decided in Rust, so `options` is left
 *  null here rather than restated in TypeScript. */
export function aiSummary(request: AiRequest): Promise<AiSummary> {
  return invoke<AiSummary>("ai_summary", {
    options: null,
    force: false,
    ...request,
  });
}

/** Writes one stored summary to a path the user picked, header and all. */
export function exportSummary(root: string, key: string, path: string): Promise<void> {
  return invoke<void>("export_summary", { root, key, path });
}
