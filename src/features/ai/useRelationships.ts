import { useCallback, useEffect, useState } from "react";
import { analyzeImports, functionGraph, projectGraph } from "../../shared/ipc";
import type { FunctionGraph } from "../../shared/types";
import { definitionRows, fileRows, scopeRows, MAX_SCOPE_ROWS, type ConnectionRow } from "./relationships";

export type RelationshipMode = "scope" | "files" | "definitions";

/** One Function Graph per open file, shared by the Definition picker and the
 *  relationship rows so the panel never scans the same file twice. */
export function useFunctionGraph(root: string | null, file: string | null) {
  const [graph, setGraph] = useState<FunctionGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    if (!root || !file) {
      return;
    }
    functionGraph(file, root)
      .then((next) => {
        if (!cancelled) {
          setGraph(next);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, file]);

  return { graph, error };
}

/** What to admit when a listing was cut short by its cap. */
function capNote(dropped: number): string | null {
  return dropped > 0
    ? `showing ${MAX_SCOPE_ROWS} of ${MAX_SCOPE_ROWS + dropped} — open a folder to narrow it`
    : null;
}

interface Params {
  root: string | null;
  mode: RelationshipMode;
  scope: string;
  file: string | null;
  files: string[];
  definitions: string[];
  graph: FunctionGraph | null;
  /** A Definition picked in the graph, whose relationships replace the mode's. */
  focus: string | null;
  /** A block picked in the folder graph: a file, or a folder inside the scope. */
  projectFocus: string | null;
}

/** The counterparts the current target connects to, fetched per mode — but only
 *  once the reader asks. Working the listing out walks the project again (and, for
 *  files, re-reads them), so doing it on every selection change is what made the
 *  panel feel stuck. */
export function useRelationships({
  root,
  mode,
  scope,
  file,
  files,
  definitions,
  graph,
  focus,
  projectFocus,
}: Params): {
  rows: ConnectionRow[];
  loading: boolean;
  error: string | null;
  note: string | null;
  /** True when these rows are the ones the reader asked for. */
  generated: boolean;
  generate: () => void;
} {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filesKey = files.join("|");
  const definitionsKey = definitions.join("|");

  // Asked for, not assumed. Once the reader turns the listing on it follows the
  // subject — a graph selection arriving a moment later is the same question, not
  // a reason to go back to asking. A different project is a different question.
  const [asked, setAsked] = useState(false);
  const generate = useCallback(() => setAsked(true), []);
  const generated = asked;

  useEffect(() => {
    setAsked(false);
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);

    if (!root || !asked) {
      setRows([]);
      setLoading(false);
      return;
    }

    const load = async () => {
      if (!root) {
        return { rows: [] as ConnectionRow[], note: null };
      }
      // What the graph is pointing at wins: it is the most recent thing the user
      // asked about, and the section is about one Definition then.
      if (focus && graph && file) {
        return { rows: definitionRows(graph, file, [focus]), note: null };
      }
      // A block from the folder graph: a file's own imports and importers, or the
      // edges of a folder standing inside the scope.
      if (projectFocus) {
        const project = await projectGraph(root, scope);
        if (project.files.some((entry) => entry.id === projectFocus)) {
          const analysis = await analyzeImports(projectFocus, root).catch(() => null);
          return { rows: fileRows(projectFocus, project, analysis), note: null };
        }
        const listing = scopeRows(project, projectFocus);
        return { rows: listing.rows, note: capNote(listing.dropped) };
      }
      if (mode === "definitions") {
        return {
          rows: file && graph ? definitionRows(graph, file, definitions) : [],
          note: null,
        };
      }
      if (mode === "files") {
        if (files.length === 0) {
          return { rows: [] as ConnectionRow[], note: null };
        }
        const [project, ...analyses] = await Promise.all([
          projectGraph(root, scope),
          ...files.map((selected) => analyzeImports(selected, root).catch(() => null)),
        ]);
        return {
          rows: files.flatMap((selected, index) => fileRows(selected, project, analyses[index])),
          note: null,
        };
      }
      const listing = scopeRows(await projectGraph(root, ""), scope);
      return { rows: listing.rows, note: capNote(listing.dropped) };
    };

    setLoading(true);
    load()
      .then((found) => {
        if (!cancelled) {
          setRows(found.rows);
          setNote(found.note);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRows([]);
          setNote(null);
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, mode, scope, file, filesKey, definitionsKey, graph, focus, projectFocus, asked]);

  return { rows, loading, error, note, generated, generate };
}
