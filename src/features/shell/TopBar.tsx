import { useState } from "react";

interface Props {
  hasFolder: boolean;
  recents: string[];
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onOpenRecent: (path: string) => void;
  onCloseFolder: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Application top bar with a File menu and a recent-folders flyout. */
export function TopBar({
  hasFolder,
  recents,
  onOpenFolder,
  onOpenFile,
  onOpenRecent,
  onCloseFolder,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(false);

  const closeAll = () => {
    setMenuOpen(false);
    setRecentsOpen(false);
  };

  return (
    <div className="relative z-40 flex items-center gap-2 border-b border-white/10 bg-panel px-3 py-1 text-xs">
      <button
        type="button"
        onClick={() => setMenuOpen((value) => !value)}
        className="rounded px-2 py-0.5 text-white/85 hover:bg-white/10"
      >
        File
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeAll} />
          <div className="absolute left-3 top-full z-50 w-56 rounded border border-white/10 bg-panel py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                onOpenFolder();
                closeAll();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              Open Folder…
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenFile();
                closeAll();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              Open File…
            </button>
            <button
              type="button"
              onMouseEnter={() => setRecentsOpen(true)}
              onClick={() => setRecentsOpen((value) => !value)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
            >
              <span>Recent Folders</span>
              <span className="text-dimmed">▸</span>
            </button>
            {hasFolder && (
              <>
                <div className="my-1 border-t border-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    onCloseFolder();
                    closeAll();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-white/90 hover:bg-accent/10 hover:text-accent"
                >
                  Close Folder
                </button>
              </>
            )}
          </div>
        </>
      )}

      {menuOpen && recentsOpen && (
        <div
          onMouseLeave={() => setRecentsOpen(false)}
          className="absolute left-80 top-full z-50 max-h-[70vh] w-80 overflow-auto rounded border border-white/10 bg-panel p-2 shadow-lg"
        >
          <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-dimmed">
            Recent folders
          </div>
          {recents.length === 0 ? (
            <div className="px-1 py-1 text-xs text-dimmed">none yet</div>
          ) : (
            <ul className="m-0 list-none p-0">
              {recents.map((path) => (
                <li key={path} className="flex items-start gap-1">
                  <span className="shrink-0 text-accent/60">•</span>
                  <button
                    type="button"
                    title={path}
                    onClick={() => {
                      onOpenRecent(path);
                      closeAll();
                    }}
                    className="min-w-0 flex-1 truncate py-1 text-left text-xs text-white/85 hover:text-accent"
                  >
                    {baseName(path)}
                    <span className="ml-2 text-[10px] text-dimmed">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
