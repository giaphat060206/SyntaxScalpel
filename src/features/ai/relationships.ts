import type { FunctionGraph, ImportAnalysis, ProjectGraph } from "../../shared/types";

/** What a row names about the code on screen. */
export interface ConnectionRow {
  direction: "calls" | "called by" | "imports" | "imported by";
  /** The counterpart, as it should read. */
  label: string;
  /** The canonical pair, caller or importing end first, both ends qualified. */
  source: string;
  target: string;
  /** The two canvas node ids to emphasise on hover, when both are drawn. */
  nodes: [string, string];
  /** The counterpart's canvas node id, when the graph draws it. */
  counterpart: string;
}

const SEPARATOR = "::";

/** A Definition shown from another file already carries its file; a local one
 *  does not, so it takes the file being viewed. */
export function qualify(end: string, viewedFile: string): string {
  return end.includes(SEPARATOR) ? end : `${viewedFile}${SEPARATOR}${end}`;
}

export function connectionFile(end: string): string {
  const at = end.indexOf(SEPARATOR);
  return at > 0 ? end.slice(0, at) : end;
}

/**
 * One row per Cross-file Call Edge touching a selected Definition, from the
 * viewed file's point of view. Qualifying both ends is what makes the pair — and
 * so the cache key — identical whichever file the user is looking at.
 */
export function definitionRows(
  graph: FunctionGraph,
  viewedFile: string,
  selected: string[]
): ConnectionRow[] {
  const chosen = new Set(selected);
  const rows: ConnectionRow[] = [];
  for (const edge of graph.crossEdges) {
    const caller = qualify(edge.source, viewedFile);
    const callee = qualify(edge.target, viewedFile);
    const iAmCaller = chosen.has(edge.source) && connectionFile(caller) === viewedFile;
    const iAmCallee = chosen.has(edge.target) && connectionFile(callee) === viewedFile;
    if (!iAmCaller && !iAmCallee) {
      continue;
    }
    rows.push(
      iAmCaller
        ? {
            direction: "calls",
            label: callee,
            source: caller,
            target: callee,
            nodes: [edge.source, edge.target],
            counterpart: edge.target,
          }
        : {
            direction: "called by",
            label: caller,
            source: caller,
            target: callee,
            nodes: [edge.source, edge.target],
            counterpart: edge.source,
          }
    );
  }
  return sorted(rows);
}

/** A file's imports (resolved, so the row can highlight the block) and the files
 *  importing it. */
export function fileRows(
  file: string,
  project: ProjectGraph | null,
  analysis: ImportAnalysis | null
): ConnectionRow[] {
  const rows: ConnectionRow[] = [];
  const entry = project?.files.find((candidate) => candidate.id === file);
  for (const imported of entry?.imports ?? []) {
    if (!imported.targetId) {
      continue;
    }
    rows.push({
      direction: "imports",
      label: imported.targetId,
      source: file,
      target: imported.targetId,
      nodes: [file, imported.targetId],
      counterpart: imported.targetId,
    });
  }
  for (const importer of analysis?.importedBy ?? []) {
    rows.push({
      direction: "imported by",
      label: importer.path,
      source: importer.path,
      target: file,
      nodes: [importer.path, file],
      counterpart: importer.path,
    });
  }
  return sorted(rows);
}

/**
 * What a Scope depends on. A project-wide scan can only see edges that leave the
 * scope, because a file outside the project root is never parsed, so "imported
 * by" for a whole Scope is not derivable — per file it is.
 */
export function scopeRows(project: ProjectGraph | null, scope: string): ConnectionRow[] {
  const rows: ConnectionRow[] = [];
  const inside = (id: string) =>
    scope === "" ? !id.startsWith("../") : id === scope || id.startsWith(`${scope}/`);
  const external = new Set(
    (project?.files ?? []).filter((file) => file.external).map((file) => file.id)
  );
  for (const edge of project?.edges ?? []) {
    if (!external.has(edge.target) || !inside(edge.source)) {
      continue;
    }
    rows.push({
      direction: "imports",
      label: edge.target,
      source: edge.source,
      target: edge.target,
      nodes: [edge.source, edge.target],
      counterpart: edge.target,
    });
  }
  return sorted(rows);
}

function sorted(rows: ConnectionRow[]): ConnectionRow[] {
  return rows.sort(
    (left, right) =>
      left.direction.localeCompare(right.direction) || left.label.localeCompare(right.label)
  );
}
