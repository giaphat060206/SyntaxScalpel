import { useEffect, useState } from "react";
import type { ImportAnalysis } from "../../shared/types";
import { routeForExtension } from "../../shared/extensions";
import { analyzeImports } from "../../shared/ipc";

/**
 * Loads the import analysis (this file's imports + project files importing it)
 * for code files. Returns null for docs, unsupported files, errors, and while
 * there is nothing to load.
 */
export function useImports(
  root: string | null,
  filePath: string | null
): ImportAnalysis | null {
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);

  useEffect(() => {
    if (!root || !filePath) {
      setAnalysis(null);
      return;
    }
    const route = routeForExtension(filePath);
    if (route !== "python" && route !== "jsts") {
      setAnalysis(null);
      return;
    }

    let cancelled = false;
    analyzeImports(filePath, root)
      .then((next) => {
        if (!cancelled) setAnalysis(next);
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null);
      });

    return () => {
      cancelled = true;
    };
  }, [root, filePath]);

  return analysis;
}
