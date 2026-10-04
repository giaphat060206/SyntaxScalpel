import { Fragment, useEffect, useState } from "react";
import { functionGraph } from "../../shared/ipc";
import type { FunctionGraph, GraphNode } from "../../shared/types";

interface Props {
  root: string;
  file: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

interface Entry {
  id: string;
  label: string;
  indent: number;
}

function kindWord(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "class":
      return "class";
    case "method":
      return "method";
    case "variable":
      return "var";
    default:
      return "fn";
  }
}

/** The Definitions of one Code File, plus the ones its Cross-file Blocks show.
 *  An imported Definition keeps the qualified id the parser gave it, so picking
 *  it here and picking it in its own file produce the same Digest — and so the
 *  same cached answer. */
export function DefinitionPicker({ root, file, selected, onChange }: Props) {
  const [graph, setGraph] = useState<FunctionGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setError(null);
    functionGraph(file, root)
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
  }, [root, file]);

  const chosen = new Set(selected);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange([...next]);
  };

  const line = (entry: Entry) => (
    <label
      key={entry.id}
      className={`flex items-center gap-1 text-xs ${
        chosen.has(entry.id) ? "text-accent" : "text-white/85"
      }`}
      style={{ paddingLeft: `${entry.indent * 12}px` }}
      title={entry.id}
    >
      <input type="checkbox" checked={chosen.has(entry.id)} onChange={() => toggle(entry.id)} />
      <span className="truncate">{entry.label}</span>
    </label>
  );

  if (error) {
    return <p className="m-0 text-xs text-red-400">{error}</p>;
  }
  if (!graph) {
    return <p className="m-0 text-xs text-dimmed">reading the file…</p>;
  }

  const own = graph.file.nodes;
  const containers = own.filter((node) => node.kind === "class" && !node.parent);
  const loose = own.filter((node) => node.kind !== "class" && !node.parent);
  const entries: Entry[] = [
    ...containers.flatMap((node) => [
      { id: node.id, label: `class ${node.name}`, indent: 0 },
      ...own
        .filter((child) => child.parent === node.id)
        .map((child) => ({ id: child.id, label: child.name, indent: 1 })),
    ]),
    ...loose.map((node) => ({
      id: node.id,
      label: `${kindWord(node.kind)} ${node.name}`,
      indent: 0,
    })),
  ];

  return (
    <div className="max-h-56 overflow-auto">
      {entries.length === 0 ? (
        <p className="m-0 text-xs text-dimmed">this file declares nothing to explain</p>
      ) : (
        entries.map(line)
      )}
      {graph.externals.map((block) => (
        <Fragment key={block.path}>
          <div className="mt-1 truncate text-[10px] uppercase tracking-wider text-dimmed">
            from {block.path}
          </div>
          {block.nodes.map((node) =>
            line({
              id: `${block.path}::${node.id}`,
              label: `${kindWord(node.kind)} ${node.name}`,
              indent: 0,
            })
          )}
        </Fragment>
      ))}
    </div>
  );
}
