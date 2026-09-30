import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useFileContent } from "./useFileContent";
import { useImports } from "./useImports";
import { GraphView } from "../graph/GraphView";
import { MarkdownView } from "../markdown/MarkdownView";
import { CodeView } from "../code/CodeView";
import { ErrorState, EmptyState } from "../../shared/StateViews";
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

  useEffect(() => {
    setSelectedId(null);
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

  const graph = (
    <GraphView
      result={state.result}
      imports={imports}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );

  // Clicking a function, method or class shows its source section beside the
  // graph; the graph stays visible so other definitions can be picked.
  if (
    source !== null &&
    filePath &&
    selectedNode &&
    selectedNode.startLine !== undefined &&
    selectedNode.endLine !== undefined
  ) {
    return (
      <Group orientation="horizontal">
        <Panel minSize="30%">{graph}</Panel>
        <Separator className="w-1 bg-white/10" />
        <Panel defaultSize="45%" minSize="20%">
          <CodeView
            code={source}
            filePath={filePath}
            startLine={selectedNode.startLine}
            endLine={selectedNode.endLine}
            title={selectedNode.name}
          />
        </Panel>
      </Group>
    );
  }

  return graph;
}
