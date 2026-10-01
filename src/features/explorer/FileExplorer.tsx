import { useCallback, useEffect, useRef, useState } from "react";
import { listDirectory, type FileEntry } from "../../shared/ipc";
import { useSearch, type SearchItem } from "../shell/SearchContext";

interface Props {
  root: string | null;
  onSelectFile: (relPath: string) => void;
  onSelectFolder: (relPath: string) => void;
  selectedFile: string | null;
}

export function FileExplorer({
  root,
  onSelectFile,
  onSelectFolder,
  selectedFile,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Directories start collapsed; the set holds the ones the user opened.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { items: searchItems, pick: pickSearch } = useSearch();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const trimmedQuery = query.trim().toLowerCase();
  const results = trimmedQuery
    ? searchItems
        .filter((item) => item.label.toLowerCase().includes(trimmedQuery))
        .slice(0, 50)
    : [];

  const pickResult = useCallback(
    (item: SearchItem) => {
      // Files and folders open their graph; symbols (functions, methods…)
      // centre inside the code graph that published them.
      if (item.hint === "folder") {
        onSelectFolder(item.id);
      } else if (item.hint === "code" || item.hint === "doc" || item.hint === "ext") {
        onSelectFile(item.id);
      } else {
        pickSearch(item.id);
      }
      setQuery("");
    },
    [onSelectFolder, onSelectFile, pickSearch]
  );

  useEffect(() => {
    setExpanded(new Set());
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
      <input
        ref={searchRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            pickResult(results[0]);
          }
          if (event.key === "Escape") {
            setQuery("");
            event.currentTarget.blur();
          }
        }}
        placeholder="Search (Ctrl+F)…"
        className="mb-2 w-full rounded border border-white/15 bg-bg px-2 py-1 text-xs text-white outline-none focus:border-accent"
      />
      {query.trim().length > 0 && (
        <ul className="m-0 mb-2 max-h-56 list-none overflow-auto p-0">
          {results.length === 0 ? (
            <li className="px-1 py-1 text-xs text-dimmed">no matches</li>
          ) : (
            results.map((item) => (
              <li key={item.id} className="flex items-start gap-1">
                <span className="shrink-0 text-accent/60">•</span>
                <button
                  type="button"
                  onClick={() => pickResult(item)}
                  title={item.id}
                  className="min-w-0 flex-1 truncate py-0.5 text-left text-xs text-white/85 hover:text-accent"
                >
                  {item.hint && (
                    <span className="mr-1 text-[10px] uppercase tracking-wider text-dimmed">
                      {item.hint}
                    </span>
                  )}
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {!root && <p className="text-dimmed text-sm">No folder open.</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {root && renderEntries(entries, 0)}
    </div>
  );
}
