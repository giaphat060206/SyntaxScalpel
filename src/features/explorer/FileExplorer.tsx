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

export function FileExplorer({
  root,
  onOpenFolder,
  onSelectFile,
  onSelectFolder,
  selectedFile,
}: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      {items.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            onClick={() =>
              entry.isDir ? onSelectFolder(entry.path) : onSelectFile(entry.path)
            }
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            className={
              "block w-full text-left px-2 py-1 text-sm rounded " +
              (selectedFile === entry.path
                ? "bg-accent/20 text-accent"
                : entry.isDir
                  ? "text-dimmed hover:bg-white/5"
                  : "text-white/90 hover:bg-white/5")
            }
          >
            {entry.isDir ? `▸ ${entry.name}` : entry.name}
          </button>
          {entry.isDir && renderEntries(entry.children, depth + 1)}
        </li>
      ))}
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
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {root && renderEntries(entries, 0)}
    </div>
  );
}
