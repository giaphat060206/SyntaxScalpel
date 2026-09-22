import { useCallback, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FileExplorer } from "../explorer/FileExplorer";
import { ContentPane } from "./ContentPane";
import { useLayoutAutosave } from "../graph/useLayoutAutosave";
import type { LayoutMap } from "../../shared/types";

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [codeFile, setCodeFile] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);

  const activeFile = splitMode && docFile ? docFile : (codeFile ?? docFile);
  const savePositions = useLayoutAutosave(root, codeFile);

  const handleOpenFolder = useCallback((nextRoot: string) => {
    setRoot(nextRoot);
    setCodeFile(null);
    setDocFile(null);
  }, []);

  const handleSelectFile = useCallback((relPath: string) => {
    if (relPath.toLowerCase().endsWith(".md")) {
      setDocFile(relPath);
    } else {
      setCodeFile(relPath);
    }
  }, []);

  const handleDragStop = useCallback(
    (positions: LayoutMap) => savePositions(positions),
    [savePositions]
  );

  return (
    <div className="h-full bg-bg">
      <Group orientation="horizontal">
        <Panel defaultSize="22%" minSize="12%" className="border-r border-white/10">
          <FileExplorer
            root={root}
            onOpenFolder={handleOpenFolder}
            onSelectFile={handleSelectFile}
            selectedFile={activeFile}
          />
        </Panel>
        <Separator className="w-1 bg-white/10" />
        <Panel>
          <Group orientation="horizontal">
            {splitMode && docFile && (
              <>
                <Panel defaultSize="50%" minSize="20%">
                  <ContentPane root={root} filePath={docFile} onDragStop={handleDragStop} />
                </Panel>
                <Separator className="w-1 bg-white/10" />
              </>
            )}
            <Panel minSize="20%">
              <ContentPane
                root={root}
                filePath={splitMode && docFile ? codeFile : activeFile}
                onDragStop={handleDragStop}
              />
            </Panel>
          </Group>
          <button
            type="button"
            onClick={() => setSplitMode((value) => !value)}
            className="absolute bottom-3 right-3 z-10 rounded border border-accent/40 bg-panel px-3 py-1 text-xs text-accent hover:bg-accent/10"
          >
            {splitMode ? "Single view" : "Split view"}
          </button>
        </Panel>
      </Group>
    </div>
  );
}
