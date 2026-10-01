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
  position?: Position;
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
