import { useCallback, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FileExplorer } from "../explorer/FileExplorer";
import { ContentPane } from "./ContentPane";
import { Breadcrumb } from "./Breadcrumb";
import { ProjectGraph } from "../project/ProjectGraph";
import { useLayoutAutosave } from "../graph/useLayoutAutosave";
import type { LayoutMap } from "../../shared/types";

const iconButton =
  "flex h-6 w-6 items-center justify-center rounded-full border border-accent/40 bg-panel text-accent hover:bg-accent/10";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "left" ? (
        <polyline points="15 18 9 12 15 6" />
      ) : (
        <polyline points="9 18 15 12 9 6" />
      )}
    </svg>
  );
}

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [location, setLocationState] = useState<
    { kind: "empty" } | { kind: "folder"; path: string } | { kind: "code"; path: string }
  >({ kind: "empty" });
  const [docFile, setDocFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [docsCollapsed, setDocsCollapsed] = useState(false);

  const codeFile = location.kind === "code" ? location.path : null;

  const savePositions = useLayoutAutosave(root, codeFile);

  const handleOpenFolder = useCallback((nextRoot: string) => {
    setRoot(nextRoot);
    setLocationState({ kind: "empty" });
    setDocFile(null);
    setSelectedFile(null);
  }, []);

  const handleSelectFile = useCallback((relPath: string) => {
    setSelectedFile(relPath);
    if (relPath.toLowerCase().endsWith(".md")) {
      setDocFile(relPath);
      setDocsCollapsed(false);
    } else {
      setLocationState({ kind: "code", path: relPath });
    }
  }, []);

  const handleSelectFolder = useCallback((relPath: string) => {
    setSelectedFile(relPath);
    setLocationState({ kind: "folder", path: relPath });
  }, []);

  const handleDragStop = useCallback(
    (positions: LayoutMap) => savePositions(positions),
    [savePositions]
  );

  const showDocs = Boolean(codeFile && docFile && !docsCollapsed);
  const mainFile = showDocs ? codeFile : (codeFile ?? docFile);

  return (
    <div className="h-full bg-bg">
      <Group orientation="horizontal">
        {explorerCollapsed ? (
          <Panel
            defaultSize="40px"
            minSize="40px"
            maxSize="40px"
            className="border-r border-white/10"
          >
            <div className="flex h-full justify-center pt-2">
              <button
                type="button"
                title="Show files"
                onClick={() => setExplorerCollapsed(false)}
                className={iconButton}
              >
                <Chevron direction="right" />
              </button>
            </div>
          </Panel>
        ) : (
          <>
            <Panel
              defaultSize="20%"
              minSize="12%"
              maxSize="40%"
              className="border-r border-white/10"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
                  <span className="text-[10px] uppercase tracking-wider text-dimmed">
                    Files
                  </span>
                  <button
                    type="button"
                    title="Hide files"
                    onClick={() => setExplorerCollapsed(true)}
                    className={iconButton}
                  >
                    <Chevron direction="left" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <FileExplorer
                    root={root}
                    onOpenFolder={handleOpenFolder}
                    onSelectFile={handleSelectFile}
                    onSelectFolder={handleSelectFolder}
                    selectedFile={selectedFile}
                  />
                </div>
              </div>
            </Panel>
            <Separator className="w-1 bg-white/10" />
          </>
        )}

        <Panel minSize="20%" className="relative">
          {location.kind !== "empty" && (
            <Breadcrumb
              path={location.path}
              kind={location.kind}
              onNavigate={setLocationState}
            />
          )}
          <div className="h-[calc(100%-28px)]">
            {location.kind === "folder" ? (
              <ProjectGraph
                root={root ?? ""}
                scope={location.path}
                onNavigate={setLocationState}
              />
            ) : (
              <ContentPane root={root} filePath={mainFile} onDragStop={handleDragStop} />
            )}
          </div>
          {codeFile && docFile && docsCollapsed && (
            <button
              type="button"
              onClick={() => setDocsCollapsed(false)}
              className="absolute bottom-3 right-3 z-10 rounded border border-accent/40 bg-panel px-3 py-1 text-xs text-accent hover:bg-accent/10"
            >
              Show docs
            </button>
          )}
        </Panel>

        {showDocs && (
          <>
            <Separator className="w-1 bg-white/10" />
            <Panel defaultSize="40%" minSize="20%">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
                  <span className="text-[10px] uppercase tracking-wider text-dimmed">
                    Docs
                  </span>
                  <button
                    type="button"
                    title="Hide docs"
                    onClick={() => setDocsCollapsed(true)}
                    className={iconButton}
                  >
                    <Chevron direction="right" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <ContentPane root={root} filePath={docFile} onDragStop={handleDragStop} />
                </div>
              </div>
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
