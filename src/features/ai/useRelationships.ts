import { useEffect, useState } from "react";
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
}

/** The counterparts the current target connects to, fetched per mode. */
export function useRelationships({
  root,
  mode,
  scope,
  file,
  files,
  definitions,
  graph,
  focus,
}: Params): { rows: ConnectionRow[]; loading: boolean; error: string | null; note: string | null } {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filesKey = files.join("|");
  const definitionsKey = definitions.join("|");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);

    const load = async () => {
      if (!root) {
        return { rows: [] as ConnectionRow[], note: null };
      }
      // What the graph is pointing at wins: it is the most recent thing the user
      // asked about, and the section is about one Definition then.
      if (focus && graph && file) {
        return { rows: definitionRows(graph, file, [focus]), note: null };
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
      return {
        rows: listing.rows,
        note:
          listing.dropped > 0
            ? `showing ${MAX_SCOPE_ROWS} of ${MAX_SCOPE_ROWS + listing.dropped} — open a folder to narrow it`
            : null,
      };
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
  }, [root, mode, scope, file, filesKey, definitionsKey, graph, focus]);

  return { rows, loading, error, note };
}
