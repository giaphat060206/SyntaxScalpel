import { useCallback } from "react";
import { projectGraph } from "../../shared/ipc";
import type { ProjectGraph } from "../../shared/types";
import { useAsyncLoad, type LoadState } from "../shell/useAsyncLoad";

/**
 * One project scan, shared by the dashboard and the graph. Both describe the
 * same folder, so switching between them must not walk the project twice. The
 * key is the root and the scope together, which is what makes a view change —
 * same folder, different view — leave the payload alone.
 */
export function useProjectGraph(
  root: string | null,
  scope: string | null
): LoadState<ProjectGraph> {
  const ready = root !== null && scope !== null;
  const load = useCallback(
    () => projectGraph(root ?? "", scope ?? ""),
    [root, scope]
  );

  return useAsyncLoad<ProjectGraph>(
    ready ? `${root}|${scope}` : null,
    ready ? load : null
  );
}
