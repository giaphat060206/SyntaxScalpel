interface Props {
  recents: string[];
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onClearRecents: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Start screen shown when no folder is open (VS Code style). */
export function Welcome({
  recents,
  onOpenFolder,
  onOpenFile,
  onOpenRecent,
  onClearRecents,
}: Props) {
  return (
    <div className="h-full overflow-auto bg-bg px-8 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="font-mono text-2xl text-accent">SyntaxScalpel</h1>
        <p className="mt-1 text-sm text-dimmed">
          Dissect a codebase into graphs and docs. Open a folder to begin.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded border border-accent/40 px-3 py-2 text-sm text-accent hover:bg-accent/10"
          >
            Open Folder…
          </button>
          <button
            type="button"
            onClick={onOpenFile}
            className="rounded border border-white/15 px-3 py-2 text-sm text-white/90 hover:bg-white/5"
          >
            Open File…
          </button>
        </div>

        {recents.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-dimmed">
                Recent folders
              </span>
              <button
                type="button"
                onClick={onClearRecents}
                className="text-[10px] uppercase tracking-wider text-dimmed hover:text-accent"
              >
                Clear
              </button>
            </div>
            <ul className="m-0 mt-2 list-none p-0">
              {recents.map((path) => (
                <li key={path} className="flex items-start gap-1">
                  <span className="shrink-0 text-accent/60">•</span>
                  <button
                    type="button"
                    title={path}
                    onClick={() => onOpenRecent(path)}
                    className="min-w-0 flex-1 truncate py-1 text-left text-sm text-white/85 hover:text-accent"
                  >
                    {baseName(path)}
                    <span className="ml-2 text-[11px] text-dimmed">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
