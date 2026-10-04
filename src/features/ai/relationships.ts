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
}

/** Whether a row is something this side does, or something done to it. */
export function directionKind(direction: ConnectionRow["direction"]): "outbound" | "inbound" {
  return direction === "imports" || direction === "calls" ? "outbound" : "inbound";
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
    // The viewed file's end decides the direction when both ends are chosen. A
    // chosen Definition in a dashed block is not this file's, so it has to fall
    // back to whichever end it is: otherwise selecting an imported Definition
    // would list nothing at all.
    const callerHere = chosen.has(edge.source) && connectionFile(caller) === viewedFile;
    const calleeHere = chosen.has(edge.target) && connectionFile(callee) === viewedFile;
    const iAmCaller = callerHere || (!calleeHere && chosen.has(edge.source));
    const iAmCallee = !iAmCaller && (calleeHere || chosen.has(edge.target));
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
          }
        : {
            direction: "called by",
            label: caller,
            source: caller,
            target: callee,
            nodes: [edge.source, edge.target],
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
  const imported = new Set<string>();
  for (const target of entry?.imports ?? []) {
    if (!target.targetId || imported.has(target.targetId)) {
      continue;
    }
    imported.add(target.targetId);
    rows.push({
      direction: "imports",
      label: target.targetId,
      source: file,
      target: target.targetId,
      nodes: [file, target.targetId],
    });
  }
  const importers = new Set<string>();
  for (const importer of analysis?.importedBy ?? []) {
    if (importers.has(importer.path)) {
      continue;
    }
    importers.add(importer.path);
    rows.push({
      direction: "imported by",
      label: importer.path,
      source: importer.path,
      target: file,
      nodes: [importer.path, file],
    });
  }
  return sorted(rows);
}

/** How many rows a whole Scope lists. Each *pair* is probed once however many
 *  directional rows describe it, and a real project has hundreds of edges, so the
 *  listing is bounded — and says so. */
export const MAX_SCOPE_ROWS = 160;

export interface ScopeListing {
  rows: ConnectionRow[];
  /** How many relationships the cap left out, so the panel can admit it. */
  dropped: number;
}

/**
 * How a Scope's files connect, from each file's point of view.
 *
 * An edge becomes two rows: `a` importing `b`, and `b` being imported by `a`.
 * One row per pair would leave every row tagged `imports` and never name the file
 * on the receiving end, which is the half a reader asks about. Both rows carry the
 * same pair, so they share one cache key and one mark.
 *
 * Rows are grouped by the file they describe, imports before imported-by, so a
 * file's block reads as what it reaches and then what reaches it.
 */
export function scopeRows(project: ProjectGraph | null, scope: string): ScopeListing {
  const rows: ConnectionRow[] = [];
  const inside = (id: string) =>
    scope === "" ? !id.startsWith("../") : id === scope || id.startsWith(`${scope}/`);
  const known = new Set((project?.files ?? []).map((file) => file.id));
  const external = new Set(
    (project?.files ?? []).filter((file) => file.external).map((file) => file.id)
  );
  const seen = new Set<string>();
  for (const edge of project?.edges ?? []) {
    const sourceInside = inside(edge.source);
    const targetInside = inside(edge.target);
    if (!sourceInside && !targetInside) {
      continue;
    }
    // The only endpoint that can be unknown is a file beyond the project root,
    // which was never parsed and so never produced an edge.
    if (!known.has(edge.source) || !known.has(edge.target)) {
      continue;
    }
    // One pair is one relationship and one cache key, however many import lines
    // reach it.
    const pair = `${edge.source}->${edge.target}`;
    if (seen.has(pair)) {
      continue;
    }
    seen.add(pair);

    if (sourceInside) {
      rows.push({
        direction: "imports",
        label: `${edge.source} -> ${edge.target}`,
        source: edge.source,
        target: edge.target,
        nodes: [edge.source, edge.target],
      });
    }
    // An outside module being imported is the importing file's row, not its own.
    if (targetInside && !external.has(edge.target)) {
      rows.push({
        direction: "imported by",
        label: `${edge.source} -> ${edge.target}`,
        source: edge.source,
        target: edge.target,
        nodes: [edge.source, edge.target],
      });
    }
  }

  const described = (row: ConnectionRow) =>
    row.direction === "imports" ? row.source : row.target;
  const other = (row: ConnectionRow) =>
    row.direction === "imports" ? row.target : row.source;
  const rank = (row: ConnectionRow) => (row.direction === "imports" ? 0 : 1);
  rows.sort(
    (left, right) =>
      kindRank(left) - kindRank(right) ||
      described(left).localeCompare(described(right)) ||
      rank(left) - rank(right) ||
      other(left).localeCompare(other(right))
  );

  return {
    rows: rows.slice(0, MAX_SCOPE_ROWS),
    dropped: Math.max(0, rows.length - MAX_SCOPE_ROWS),
  };
}

/** Inbound first: what reaches this side reads above what it reaches, which is
 *  the half a reader scans for. */
const kindRank = (row: ConnectionRow) =>
  directionKind(row.direction) === "inbound" ? 0 : 1;

function sorted(rows: ConnectionRow[]): ConnectionRow[] {
  return rows.sort(
    (left, right) =>
      kindRank(left) - kindRank(right) ||
      left.direction.localeCompare(right.direction) ||
      left.label.localeCompare(right.label)
  );
}
