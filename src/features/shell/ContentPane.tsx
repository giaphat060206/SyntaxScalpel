import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../../shared/types";
import { useFileContent } from "./useFileContent";
import { useSource } from "./useSource";
import { GraphView } from "../graph/GraphView";
import { MarkdownView } from "../markdown/MarkdownView";
import { CodeView } from "../code/CodeView";
import { ErrorState, EmptyState } from "../../shared/StateViews";
import { ErrorBoundary } from "../../shared/ErrorBoundary";

interface Props {
  root: string | null;
  filePath: string | null;
  initialSelectedId?: string | null;
}

/** A selected Definition and the file it was declared in. */
interface Selection {
  node: GraphNode;
  path: string;
}

export function ContentPane({
  root,
  filePath,
  initialSelectedId = null,
}: Props) {
  const state = useFileContent(root, filePath);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [codePaneOpen, setCodePaneOpen] = useState(true);

  useEffect(() => {
    setSelectedId(initialSelectedId);
    setCodePaneOpen(true);
  }, [filePath, initialSelectedId]);

  const graph = state.status === "graph" ? state.graph : null;

  // A Definition reached from another file still has a real line range, in that
  // file; the dashed block standing for the file selects nothing to read.
  const selected: Selection | undefined = useMemo(() => {
    if (!graph || !selectedId) {
      return undefined;
    }
    const own = graph.file.nodes.find((node) => node.id === selectedId);
    if (own) {
      return { node: own, path: graph.file.filePath };
    }
    for (const file of graph.externals) {
      const external = file.nodes.find((node) => node.id === selectedId);
      if (external) {
        return { node: external, path: file.path };
      }
    }
    return undefined;
  }, [graph, selectedId]);

  const source = useSource(root, selected?.path ?? null, graph !== null);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    // Picking a definition (single or double click) reopens the code pane.
    if (id) {
      setCodePaneOpen(true);
    }
  }, []);

  if (state.status === "idle") {
    return <EmptyState message="Select a file to begin." />;
  }
  if (state.status === "loading") {
    return <EmptyState message="Loading…" />;
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }
  if (state.status === "markdown") {
    return <MarkdownView content={state.content} />;
  }

  const selectedNode = selected?.node;

  const hasSection = Boolean(
    selected !== undefined &&
      selectedNode?.startLine !== undefined &&
      selectedNode.endLine !== undefined
  );

  // One stable tree: the graph sits in an absolutely positioned layer that is
  // always present, and the code pane is an overlay beside it. Opening or
  // collapsing the pane therefore never remounts React Flow (no rebuild, no
  // ELK re-run).
  const codeOpen = hasSection && codePaneOpen;

  return (
    <ErrorBoundary>
      <div className="relative h-full">
        <div
          className="absolute bottom-0 left-0 top-0"
          style={{ right: codeOpen ? "45%" : 0 }}
        >
          <GraphView
            graph={state.graph}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </div>
      {hasSection && !codePaneOpen && (
        <button
          type="button"
          onClick={() => setCodePaneOpen(true)}
          title={`Show ${selectedNode?.name}`}
          className="absolute bottom-3 right-28 z-30 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
        >
          Show code
        </button>
      )}
      {codeOpen && (
        <div className="absolute right-0 top-0 z-20 h-full w-[45%] border-l border-white/10">
          <CodeView
            code={source ?? ""}
            filePath={selected?.path ?? ""}
            startLine={selectedNode?.startLine}
            endLine={selectedNode?.endLine}
            title={selectedNode?.name}
            onCollapse={() => setCodePaneOpen(false)}
          />
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
