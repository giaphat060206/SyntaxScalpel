export type NodeKind = "function" | "class" | "method" | "variable";

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  params: string[];
  returns: string[];
  uses?: string[];
  /** 1-based inclusive line range of the definition in its file. */
  startLine?: number;
  endLine?: number;
  value?: string;
  parent?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filePath: string;
}

export interface ImportEntry {
  specifier: string;
  names: string[];
}

export interface ImporterEntry {
  path: string;
  names: string[];
}

export interface ImportAnalysis {
  imports: ImportEntry[];
  importedBy: ImporterEntry[];
}

/** Definitions of another file that this file's Function Graph shows, because
 *  a Call Edge reaches them. */
export interface ExternalFile {
  /** Project-relative path; also the id its dashed block gets on the canvas. */
  path: string;
  nodes: GraphNode[];
}

/** One file's Function Graph plus the one-hop neighbourhood reaching into other
 *  files, and the Import Analysis the graph needs. */
export interface FunctionGraph {
  file: ParseResult;
  imports: ImportAnalysis;
  externals: ExternalFile[];
  crossEdges: GraphEdge[];
  /** Imports no external block drew anything for, so they stay text. */
  residualImports: ImportEntry[];
  /** Files importing this one that produced no block, for the same reason. */
  residualImportedBy: ImporterEntry[];
  truncated: boolean;
}

export interface ProjectFolder {
  id: string;
  name: string;
  parentId?: string;
  depth: number;
}

export interface FileImport {
  targetId: string;
  specifier: string;
  names: string[];
}

export interface ProjectFile {
  id: string;
  name: string;
  folderId: string;
  kind: "code" | "doc";
  /** Size on disk in bytes; 0 for an external file, which is not counted. */
  sizeBytes: number;
  imports: FileImport[];
  /** True for a file outside the scope that an in-scope file imports. */
  external?: boolean;
}

export interface ProjectEdge {
  source: string;
  target: string;
}

export interface ProjectGraph {
  root: string;
  folders: ProjectFolder[];
  files: ProjectFile[];
  edges: ProjectEdge[];
  truncated: boolean;
  entry?: string;
  entries?: string[];
}

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ApiSourceKind = "openapi" | "swagger-jsdoc" | "next-app-router";

export type ApiFidelity = "full" | "heuristic";

export interface ApiSource {
  kind: ApiSourceKind;
  file: string;
}

export interface ApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Json;
}

export interface ApiResponse {
  status: string;
  schema?: Json;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  tags: string[];
  summary?: string;
  description?: string;
  parameters: ApiParameter[];
  requestBody?: Json;
  responses: ApiResponse[];
  handler?: string;
  handlerFile?: string;
  file: string;
  line: number;
  sourceKind: ApiSourceKind;
  fidelity: ApiFidelity;
}

export interface ApiInventory {
  sources: ApiSource[];
  endpoints: ApiEndpoint[];
  warnings: string[];
  base?: string;
}
