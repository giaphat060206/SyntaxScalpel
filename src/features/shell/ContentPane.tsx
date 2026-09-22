import { useEffect, useState } from "react";
import type { LayoutMap } from "../../shared/types";
import { useFileContent } from "./useFileContent";
import { GraphView } from "../graph/GraphView";
import { MarkdownView } from "../markdown/MarkdownView";
import { ErrorState, EmptyState } from "../../shared/StateViews";

interface Props {
  root: string | null;
  filePath: string | null;
  onDragStop: (positions: LayoutMap) => void;
}

export function ContentPane({ root, filePath, onDragStop }: Props) {
  const state = useFileContent(root, filePath);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [filePath]);

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
  return (
    <GraphView
      result={state.result}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onDragStop={onDragStop}
    />
  );
}
