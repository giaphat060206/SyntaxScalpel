import { useCallback } from "react";
import type { ApiInventory } from "../../shared/types";
import { analyzeApi } from "../../shared/ipc";
import { useAsyncLoad, type LoadState } from "./useAsyncLoad";

export function useApiInventory(root: string): LoadState<ApiInventory> {
  const load = useCallback(() => analyzeApi(root), [root]);

  return useAsyncLoad<ApiInventory>(root, load);
}
