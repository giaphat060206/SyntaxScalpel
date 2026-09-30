import { useCallback, useEffect, useMemo, useState } from "react";
import { useFileContent } from "./useFileContent";
import { useImports } from "./useImports";
import { GraphView } from "../graph/GraphView";
import { MarkdownView } from "../markdown/MarkdownView";
import { CodeView } from "../code/CodeView";
import { ErrorState, EmptyState } from "../../shared/StateViews";
import { ErrorBoundary } from "../../shared/ErrorBoundary";
import { readFile } from "../../shared/ipc";

interface Props {
  root: string | null;
  filePath: string | null;
}

export function ContentPane({ root, filePath }: Props) {
  const state = useFileContent(root, filePath);
  const imports = useImports(root, filePath);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [codePaneOpen, setCodePaneOpen] = useState(true);

  useEffect(() => {
    setSelectedId(null);
    setCodePaneOpen(true);
  }, [filePath]);

  const isGraph = state.status === "graph";

  // Load the file source once per open file, for the code reader.
  useEffect(() => {
    if (!root || !filePath || !isGraph) {
      setSource(null);
      return;
    }
    let cancelled = false;
    readFile(filePath, root)
      .then((text) => {
        if (!cancelled) setSource(text);
      })
      .catch(() => {
        if (!cancelled) setSource(null);
      });
    return () => {
      cancelled = true;
    };
  }, [root, filePath, isGraph]);

  const selectedNode = useMemo(() => {
    if (!isGraph || !selectedId) {
      return undefined;
    }
    return state.result.nodes.find((node) => node.id === selectedId);
  }, [isGraph, state, selectedId]);

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

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      // Picking a definition (single or double click) reopens the code pane.
      if (id) {
        setCodePaneOpen(true);
      }
    },
    []
  );

  const graph = (
    <GraphView
      result={state.result}
      imports={imports}
      selectedId={selectedId}
      onSelect={handleSelect}
    />
  );

  const hasSection = Boolean(
    source !== null &&
      filePath !== null &&
      selectedNode !== undefined &&
      selectedNode.startLine !== undefined &&
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
          {graph}
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
            filePath={filePath ?? ""}
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
