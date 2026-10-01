import { useCallback } from "react";
import type { ImportAnalysis } from "../../shared/types";
import { routeForExtension } from "../../shared/extensions";
import { analyzeImports } from "../../shared/ipc";
import { useAsyncLoad } from "./useAsyncLoad";

/**
 * Loads the import analysis (this file's imports + project files importing it)
 * for code files. Returns null for docs, unsupported files, errors, and while
 * there is nothing to load.
 */
export function useImports(
  root: string | null,
  filePath: string | null
): ImportAnalysis | null {
  const route = filePath ? routeForExtension(filePath) : "unsupported";
  const isCode = route === "python" || route === "jsts";
  const enabled = Boolean(root && filePath && isCode);

  const load = useCallback(() => {
    if (!root || !filePath) {
      return Promise.reject(new Error("No file"));
    }
    return analyzeImports(filePath, root);
  }, [root, filePath]);

  const state = useAsyncLoad<ImportAnalysis>(
    enabled ? `${root}|${filePath}` : null,
    enabled ? load : null
  );

  return state.status === "ready" ? state.value : null;
}
