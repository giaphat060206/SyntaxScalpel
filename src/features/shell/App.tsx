import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Group, Panel, Separator } from "react-resizable-panels";
import { FileExplorer } from "../explorer/FileExplorer";
import { ContentPane } from "./ContentPane";
import { Breadcrumb } from "./Breadcrumb";
import { SearchProvider } from "./SearchContext";
import { ErrorBoundary } from "../../shared/ErrorBoundary";
import { Welcome } from "./Welcome";
import { TopBar } from "./TopBar";
import { useRecents } from "./useRecents";
import { ProjectGraph } from "../project/ProjectGraph";
import { EndpointsPane } from "../endpoints/EndpointsPane";

type Location =
  | { kind: "empty" }
  | { kind: "folder"; path: string }
  | { kind: "code"; path: string }
  | { kind: "endpoints" };

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
  const [location, setLocationState] = useState<Location>({ kind: "empty" });
  const [docFile, setDocFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [docsCollapsed, setDocsCollapsed] = useState(false);
  const { recents, remember, clear } = useRecents();

  const codeFile = location.kind === "code" ? location.path : null;

  const handleOpenFolder = useCallback(
    (nextRoot: string) => {
      setRoot(nextRoot);
      setDocFile(null);
      setSelectedFile(null);
      remember(nextRoot);
      // Show the project graph for the newly opened folder straight away.
      setLocationState({ kind: "folder", path: "" });
    },
    [remember]
  );

  const handleCloseFolder = useCallback(() => {
    setRoot(null);
    setDocFile(null);
    setSelectedFile(null);
    setLocationState({ kind: "empty" });
  }, []);

  const handleOpenEndpoints = useCallback(() => {
    setLocationState({ kind: "endpoints" });
  }, []);

  const handleOpenHandler = useCallback(() => {}, []);

  const pickFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      handleOpenFolder(picked);
    }
  }, [handleOpenFolder]);

  // Open a single file: treat its directory as the project root.
  const handleOpenFile = useCallback(async () => {
    const picked = await open({ directory: false, multiple: false });
    if (typeof picked !== "string") {
      return;
    }
    const normalized = picked.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const dir = slash > 0 ? normalized.slice(0, slash) : normalized;
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    setRoot(dir);
    setDocFile(null);
    setSelectedFile(null);
    remember(dir);
    setSelectedFile(name);
    if (name.toLowerCase().endsWith(".md")) {
      setDocFile(name);
      setLocationState({ kind: "empty" });
    } else {
      setLocationState({ kind: "code", path: name });
    }
  }, [remember]);

  const handleSelectFile = useCallback((relPath: string) => {
    setSelectedFile(relPath);
    if (relPath.toLowerCase().endsWith(".md")) {
      setDocFile(relPath);
      setDocsCollapsed(false);
      setLocationState((current) =>
        current.kind === "folder" ? { kind: "empty" } : current
      );
    } else {
      setLocationState({ kind: "code", path: relPath });
      setSelectedFile(relPath);
    }
  }, []);

  const handleSelectFolder = useCallback((relPath: string) => {
    setSelectedFile(relPath);
    setLocationState({ kind: "folder", path: relPath });
  }, []);

  const showDocs = Boolean(codeFile && docFile && !docsCollapsed);
  const mainFile = showDocs ? codeFile : (codeFile ?? docFile);
  const isPathLocation = location.kind === "folder" || location.kind === "code";

  return (
    <SearchProvider>
      <div className="flex h-full flex-col bg-bg">
        <TopBar
          hasFolder={Boolean(root)}
          recents={recents}
          onOpenFolder={pickFolder}
          onOpenFile={handleOpenFile}
          onOpenRecent={handleOpenFolder}
          onCloseFolder={handleCloseFolder}
          onOpenEndpoints={handleOpenEndpoints}
        />
        <div className="min-h-0 flex-1">
      {!root ? (
        <Welcome
          recents={recents}
          onOpenFolder={pickFolder}
          onOpenFile={handleOpenFile}
          onOpenRecent={handleOpenFolder}
          onClearRecents={clear}
        />
      ) : (
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
                  <button
                    type="button"
                    title="Close folder (back to Welcome)"
                    onClick={handleCloseFolder}
                    className={iconButton}
                  >
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
                      <path d="M3 10.5 12 3l9 7.5" />
                      <path d="M5 9.5V21h14V9.5" />
                    </svg>
                  </button>
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
                    onSelectFile={handleSelectFile}
                    onSelectFolder={handleSelectFolder}
                    selectedFile={isPathLocation ? location.path : selectedFile}
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
              path={isPathLocation ? location.path : ""}
              kind={location.kind === "code" ? "code" : "folder"}
              onNavigate={setLocationState}
            />
          )}
          <div
            className={
              location.kind === "empty" ? "h-full" : "h-[calc(100%-28px)]"
            }
          >
            {location.kind === "folder" ? (
              <ErrorBoundary>
                <ProjectGraph
                  root={root ?? ""}
                  scope={location.path}
                  onNavigate={setLocationState}
                />
              </ErrorBoundary>
            ) : location.kind === "endpoints" ? (
              <ErrorBoundary>
                <EndpointsPane
                  root={root ?? ""}
                  onOpenHandler={handleOpenHandler}
                />
              </ErrorBoundary>
            ) : (
              <ContentPane root={root} filePath={mainFile} />
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
                  <ContentPane root={root} filePath={docFile} />
                </div>
              </div>
            </Panel>
          </>
        )}
      </Group>
      </div>
      )}
        </div>
      </div>
    </SearchProvider>
  );
}
