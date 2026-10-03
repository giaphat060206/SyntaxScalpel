import { useCallback, useState } from "react";

const RECENTS_KEY = "scalpel.recentRoots";
const MAX_RECENTS = 12;

/** One canonical form so `C:\a\b` and `C:/a/b` are the same folder. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string") {
        continue;
      }
      const path = normalize(value);
      if (path && !seen.has(path)) {
        seen.add(path);
        cleaned.push(path);
      }
    }
    return cleaned;
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
    const canonical = normalize(path);
    if (!canonical) {
      return;
    }
    setRecents((current) => {
      const next = [
        canonical,
        ...current.filter((entry) => normalize(entry) !== canonical),
      ].slice(0, MAX_RECENTS);
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
