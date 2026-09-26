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

export type LayoutMap = Record<string, Position>;

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
