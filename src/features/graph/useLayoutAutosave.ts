import { useCallback, useEffect, useRef } from "react";
import type { LayoutMap } from "../../shared/types";
import { saveLayout } from "../../shared/ipc";

export function useLayoutAutosave(
  root: string | null,
  filePath: string | null
): (positions: LayoutMap) => void {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  return useCallback(
    (positions: LayoutMap) => {
      if (!root || !filePath) return;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        saveLayout(root, filePath, positions).catch((error) =>
          console.error("save_layout failed", error)
        );
      }, 500);
    },
    [root, filePath]
  );
}
