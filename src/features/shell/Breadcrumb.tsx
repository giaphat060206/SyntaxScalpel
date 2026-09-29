export interface Crumb {
  label: string;
  path: string;
  navigable: boolean;
}

export function breadcrumbs(path: string, kind: "folder" | "code"): Crumb[] {
  const segments = path.split("/").filter(Boolean);
  const folderCount = kind === "code" ? segments.length - 1 : segments.length;
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
    navigable: index < folderCount,
  }));
}

interface Props {
  path: string;
  kind: "folder" | "code";
  onNavigate: (location: { kind: "folder" | "code"; path: string }) => void;
}

export function Breadcrumb({ path, kind, onNavigate }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-panel px-3 py-1 text-xs">
      <button
        type="button"
        onClick={() => onNavigate({ kind: "folder", path: "" })}
        className="rounded px-1 text-accent hover:bg-accent/10"
      >
        root
      </button>
      {breadcrumbs(path, kind).map((crumb, index, crumbs) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <span className="text-dimmed">/</span>
          {crumb.navigable && index < crumbs.length - 1 ? (
            <button
              type="button"
              onClick={() => onNavigate({ kind: "folder", path: crumb.path })}
              className="rounded px-1 text-accent hover:bg-accent/10"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="px-1 text-white/80">{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
