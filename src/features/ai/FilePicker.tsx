import { Fragment, useEffect, useState } from "react";
import { projectGraph } from "../../shared/ipc";
import type { ProjectGraph } from "../../shared/types";

interface Props {
  root: string;
  scope: string;
  selected: string[];
  onChange: (files: string[]) => void;
}

const rowSelected = "rounded px-1 text-left truncate";

/** Checkbox tree over one Scope's folders and files. A folder picks every file
 *  beneath it, which is the whole point of choosing at folder level. */
export function FilePicker({ root, scope, selected, onChange }: Props) {
  const [graph, setGraph] = useState<ProjectGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    projectGraph(root, scope)
      .then((next) => {
        if (!cancelled) {
          setGraph(next);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, scope]);

  const chosen = new Set(selected);
  const files = (graph?.files ?? []).filter((file) => !file.external);
  const under = (folderId: string) =>
    files
      .filter((file) => file.folderId === folderId || file.folderId.startsWith(`${folderId}/`))
      .map((file) => file.id);

  const toggle = (paths: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const path of paths) {
      if (on) {
        next.add(path);
      } else {
        next.delete(path);
      }
    }
    onChange([...next].sort());
  };

  const box = (paths: string[], label: string, indent: number, key: string) => {
    const picked = paths.filter((path) => chosen.has(path)).length;
    return (
      <label
        key={key}
        className={`flex items-center gap-1 text-xs ${picked > 0 ? "text-accent" : "text-white/85"}`}
        style={{ paddingLeft: `${indent * 12}px` }}
      >
        <input
          type="checkbox"
          checked={paths.length > 0 && picked === paths.length}
          ref={(node) => {
            if (node) {
              node.indeterminate = picked > 0 && picked < paths.length;
            }
          }}
          onChange={(event) => toggle(paths, event.target.checked)}
        />
        <span className={rowSelected}>{label}</span>
      </label>
    );
  };

  if (error) {
    return <p className="m-0 text-xs text-red-400">{error}</p>;
  }
  if (!graph) {
    return <p className="m-0 text-xs text-dimmed">reading the scope…</p>;
  }
  if (files.length === 0) {
    return <p className="m-0 text-xs text-dimmed">no code files in this scope</p>;
  }

  const loose = files.filter(
    (file) => !graph.folders.some((folder) => folder.id === file.folderId)
  );

  return (
    <div className="max-h-56 overflow-auto">
      {graph.folders.map((folder) => (
        <Fragment key={folder.id}>
          {box(under(folder.id), folder.name || folder.id, folder.depth, `folder:${folder.id}`)}
          {files
            .filter((file) => file.folderId === folder.id)
            .map((file) => box([file.id], file.name, folder.depth + 1, file.id))}
        </Fragment>
      ))}
      {loose.map((file) => box([file.id], file.id, 0, file.id))}
    </div>
  );
}
