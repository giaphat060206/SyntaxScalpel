import { useCallback } from "react";
import { readFile } from "../../shared/ipc";
import { useAsyncLoad } from "./useAsyncLoad";

export function useSource(root: string | null, filePath: string | null, enabled: boolean): string | null {
  const load = useCallback(
    () => (root && filePath ? readFile(filePath, root) : Promise.resolve("")),
    [root, filePath]
  );
  const state = useAsyncLoad(enabled && filePath ? `${root}|${filePath}` : null, enabled ? load : null);
  return state.status === "ready" ? state.value : null;
}
