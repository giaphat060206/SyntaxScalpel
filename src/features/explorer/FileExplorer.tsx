import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listDirectory, type FileEntry } from "../../shared/ipc";

interface Props {
  root: string | null;
  onOpenFolder: (root: string) => void;
  onSelectFile: (relPath: string) => void;
  onSelectFolder: (relPath: string) => void;
  selectedFile: string | null;
}

const RECENTS_KEY = "scalpel.recentRoots";

function readRecents(): string[] {
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

function writeRecents(paths: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(paths));
  } catch {
    // Storage unavailable: recents simply do not persist.
  }
}

export function FileExplorer({
  root,
  onOpenFolder,
  onSelectFile,
  onSelectFolder,
  selectedFile,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Directories start collapsed; the set holds the ones the user opened.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  useEffect(() => {
    setExpanded(new Set());
  }, [root]);

  // Remember the opened folder so it can be reopened from the recents list.
  useEffect(() => {
    if (!root) {
      return;
    }
    setRecents((current) => {
      const next = [root, ...current.filter((entry) => entry !== root)].slice(0, 8);
      writeRecents(next);
      return next;
    });
  }, [root]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!root) {
      setEntries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setEntries([]);
    setError(null);
    listDirectory(root, "")
      .then((next) => {
        if (!cancelled) setEntries(next);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const pickFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setError(null);
      onOpenFolder(picked);
    }
  }, [onOpenFolder]);

  const renderEntries = (items: FileEntry[], depth: number) => (
    <ul className="list-none m-0 p-0">
      {items.map((entry) => {
        const isOpen = entry.isDir && expanded.has(entry.path);
        return (
          <li key={entry.path}>
            <div
              className={
                "flex items-center gap-1 rounded " +
                (selectedFile === entry.path
                  ? "bg-accent/20 text-accent"
                  : entry.isDir
                    ? "text-dimmed hover:bg-white/5"
                    : "text-white/90 hover:bg-white/5")
              }
              style={{ paddingLeft: `${4 + depth * 12}px` }}
            >
              {entry.isDir ? (
                <button
                  type="button"
                  title={isOpen ? "Collapse folder" : "Expand folder"}
                  onClick={() => toggleFolder(entry.path)}
                  className="w-4 shrink-0 text-center text-xs leading-none hover:text-accent"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <button
                type="button"
                onClick={() =>
                  entry.isDir
                    ? onSelectFolder(entry.path)
                    : onSelectFile(entry.path)
                }
                className="min-w-0 flex-1 truncate py-1 pr-2 text-left text-sm"
              >
                {entry.name}
              </button>
            </div>
            {isOpen && renderEntries(entry.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="h-full bg-panel p-3 overflow-auto">
      <button
        type="button"
        onClick={pickFolder}
        className="mb-3 w-full rounded border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10"
      >
        Open Folder
      </button>
      {!root && <p className="text-dimmed text-sm">No folder open.</p>}
      {recents.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dimmed">
            Recent folders
          </div>
          <ul className="m-0 list-none p-0">
            {recents.map((path) => (
              <li key={path} className="flex items-start gap-1">
                <span className="shrink-0 text-accent/60">•</span>
                <button
                  type="button"
                  title={path}
                  onClick={() => onOpenFolder(path)}
                  className="min-w-0 flex-1 truncate py-0.5 text-left text-xs text-white/85 hover:text-accent"
                >
                  {path.split(/[\\/]/).filter(Boolean).pop() ?? path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {root && renderEntries(entries, 0)}
    </div>
  );
}
