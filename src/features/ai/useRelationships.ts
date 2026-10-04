import { useEffect, useState } from "react";
import { analyzeImports, functionGraph, projectGraph } from "../../shared/ipc";
import type { FunctionGraph } from "../../shared/types";
import { definitionRows, fileRows, scopeRows, type ConnectionRow } from "./relationships";

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
}: Params): { rows: ConnectionRow[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filesKey = files.join("|");
  const definitionsKey = definitions.join("|");

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const load = async () => {
      if (!root) {
        return [];
      }
      if (mode === "definitions") {
        return file && graph ? definitionRows(graph, file, definitions) : [];
      }
      if (mode === "files") {
        if (files.length === 0) {
          return [];
        }
        const [project, ...analyses] = await Promise.all([
          projectGraph(root, scope),
          ...files.map((selected) => analyzeImports(selected, root).catch(() => null)),
        ]);
        return files.flatMap((selected, index) => fileRows(selected, project, analyses[index]));
      }
      return scopeRows(await projectGraph(root, ""), scope);
    };

    setLoading(true);
    load()
      .then((next) => {
        if (!cancelled) {
          setRows(next);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRows([]);
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
  }, [root, mode, scope, file, filesKey, definitionsKey, graph]);

  return { rows, loading, error };
}
