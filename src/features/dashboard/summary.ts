import type { ProjectFile, ProjectGraph } from "../../shared/types";
import { languageForName } from "./languages";

export interface LanguageShare {
  language: string;
  files: number;
  bytes: number;
  /** Fraction of the project's bytes, 0 when the project is empty. */
  share: number;
}

export interface FileSize {
  path: string;
  bytes: number;
}

export interface ProjectSummary {
  files: number;
  codeFiles: number;
  docFiles: number;
  folders: number;
  bytes: number;
  edges: number;
  externalFiles: number;
  entryPoints: string[];
  /** Sorted by bytes, largest first; ties broken by name so it cannot flap. */
  languages: LanguageShare[];
  largestFiles: FileSize[];
  truncated: boolean;
}

const LARGEST_FILES = 10;

/**
 * An external file is outside the scope — someone else's code that this project
 * imports. It is counted on its own and left out of every total, or the ratio
 * would describe what the project depends on rather than what it is.
 */
function inScope(graph: ProjectGraph): ProjectFile[] {
  return graph.files.filter((file) => !file.external);
}

export function summariseProject(graph: ProjectGraph): ProjectSummary {
  const files = inScope(graph);
  const bytes = files.reduce((total, file) => total + file.sizeBytes, 0);

  const grouped = new Map<string, LanguageShare>();
  for (const file of files) {
    const language = languageForName(file.name);
    const entry = grouped.get(language) ?? { language, files: 0, bytes: 0, share: 0 };
    entry.files += 1;
    entry.bytes += file.sizeBytes;
    grouped.set(language, entry);
  }

  const languages = [...grouped.values()]
    .map((entry) => ({ ...entry, share: bytes > 0 ? entry.bytes / bytes : 0 }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));

  const largestFiles = files
    .map((file) => ({ path: file.id, bytes: file.sizeBytes }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, LARGEST_FILES);

  return {
    files: files.length,
    codeFiles: files.filter((file) => file.kind === "code").length,
    docFiles: files.filter((file) => file.kind === "doc").length,
    folders: graph.folders.length,
    bytes,
    edges: graph.edges.length,
    externalFiles: graph.files.length - files.length,
    entryPoints: graph.entries ?? (graph.entry ? [graph.entry] : []),
    languages,
    largestFiles,
    truncated: graph.truncated,
  };
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * 1024-based with file-manager labels, so a size here matches what Explorer or
 * Finder reports for the same file. Decimal kB would read as a discrepancy.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}
