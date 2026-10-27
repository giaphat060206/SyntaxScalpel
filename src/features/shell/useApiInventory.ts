import { useCallback } from "react";
import type { ApiInventory } from "../../shared/types";
import { analyzeApi } from "../../shared/ipc";
import { useAsyncLoad, type LoadState } from "./useAsyncLoad";

/**
 * The API inventory, scanned only when `enabled`. Analysing a project reads every
 * file looking for contracts, so doing it the moment the page opens made the page
 * feel broken on a large folder; the caller asks for it with a button instead.
 */
export function useApiInventory(root: string, enabled: boolean): LoadState<ApiInventory> {
  const load = useCallback(() => analyzeApi(root), [root]);

  return useAsyncLoad<ApiInventory>(enabled ? root : null, load);
}
