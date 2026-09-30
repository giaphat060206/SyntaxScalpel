import { useCallback, useState } from "react";

const RECENTS_KEY = "scalpel.recentRoots";
const MAX_RECENTS = 12;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function write(paths: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(paths));
  } catch {
    // Storage unavailable: recents simply do not persist.
  }
}

/** Recently opened folders, newest first, persisted in localStorage. */
export function useRecents() {
  const [recents, setRecents] = useState<string[]>(() => read());

  const remember = useCallback((path: string) => {
    setRecents((current) => {
      const next = [path, ...current.filter((entry) => entry !== path)].slice(
        0,
        MAX_RECENTS
      );
      write(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    write([]);
    setRecents([]);
  }, []);

  return { recents, remember, clear };
}
