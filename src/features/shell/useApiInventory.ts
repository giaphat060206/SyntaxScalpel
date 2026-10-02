import { useCallback } from "react";
import type { ApiInventory } from "../../shared/types";
import { analyzeApi } from "../../shared/ipc";
import { useAsyncLoad, type LoadState } from "./useAsyncLoad";

export function useApiInventory(root: string | null): LoadState<ApiInventory> {
  const load = useCallback(() => {
    if (!root) {
      return Promise.reject(new Error("No folder open"));
    }
    return analyzeApi(root);
  }, [root]);

  return useAsyncLoad<ApiInventory>(root, root ? load : null);
}
