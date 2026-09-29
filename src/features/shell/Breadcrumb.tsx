interface Props {
  path: string;
  kind: "folder" | "code";
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

export function Breadcrumb({ path, kind, onNavigate }: Props) {
  const segments = path.split("/").filter(Boolean);
  const folderCount = kind === "code" ? segments.length - 1 : segments.length;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-panel px-3 py-1 text-xs">
      <button
        type="button"
        onClick={() => onNavigate({ kind: "folder", path: "" })}
        className="rounded px-1 text-accent hover:bg-accent/10"
      >
        root
      </button>
      {segments.map((segment, index) => {
        const folderPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const navigable = index < folderCount;
        return (
          <span key={folderPath} className="flex items-center gap-1">
            <span className="text-dimmed">/</span>
            {navigable && !isLast ? (
              <button
                type="button"
                onClick={() => onNavigate({ kind: "folder", path: folderPath })}
                className="rounded px-1 text-accent hover:bg-accent/10"
              >
                {segment}
              </button>
            ) : (
              <span className="px-1 text-white/80">{segment}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
