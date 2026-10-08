import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { FileExplorer } from "../explorer/FileExplorer";
import { ContentPane } from "./ContentPane";
import { Breadcrumb } from "./Breadcrumb";
import { SearchProvider } from "./SearchContext";
import { ErrorBoundary } from "../../shared/ErrorBoundary";
import { Welcome } from "./Welcome";
import { TopBar } from "./TopBar";
import { useRecents } from "./useRecents";
import { ProjectGraph } from "../project/ProjectGraph";
import { useProjectGraph } from "../project/useProjectGraph";
import { EndpointsPane } from "../endpoints/EndpointsPane";
import { AiPanel } from "../ai/AiPanel";
import { AiResultView } from "../ai/AiResultView";
import { requestKey } from "../ai/requests";
import { EmphasisProvider, type Emphasis } from "../graph/emphasis";
import { aiSummary, type AiRequest, type AiSummary } from "../../shared/ipc";

type Location =
  | { kind: "empty" }
  | { kind: "folder"; path: string }
  | { kind: "code"; path: string; select?: string }
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
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [revealRequest, setRevealRequest] = useState<{
    path: string;
    nonce: number;
  } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<AiSummary | null>(null);
  const [aiRequest, setAiRequest] = useState<AiRequest | null>(null);
  const [aiResults, setAiResults] = useState<
    Record<string, { request: AiRequest; result: AiSummary }>
  >({});
  /** The connection a pointer is over: its two ends, as canvas node ids. The
   *  AI panel's rows and the graphs' info cards both drive this. */
  const [emphasis, setEmphasis] = useState<Emphasis | null>(null);
  const { recents, remember, clear } = useRecents();

  const explorerPanel = usePanelRef();
  useEffect(() => {
    if (explorerCollapsed) {
      explorerPanel.current?.collapse();
    } else {
      explorerPanel.current?.expand();
    }
  }, [explorerCollapsed, explorerPanel]);

  // Dragging the separator can also collapse or reopen the panel, so follow the
  // panel's own state back rather than trusting the two buttons alone.
  const handleLayoutChanged = useCallback(() => {
    const collapsed = explorerPanel.current?.isCollapsed() ?? false;
    setExplorerCollapsed((previous) => (previous === collapsed ? previous : collapsed));
  }, [explorerPanel]);

  const codeFile = location.kind === "code" ? location.path : null;

  // One scan of the open folder, shared by every view that describes it. It is
  // told nothing when a file is on screen, so reading code costs no project walk.
  const projectState = useProjectGraph(
    root,
    location.kind === "folder" ? location.path : null
  );

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

  const handleOpenHandler = useCallback((file: string, handler: string) => {
    setSelectedFile(file);
    setLocationState({ kind: "code", path: file, select: handler });
  }, []);

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
    setFocusRequest(null);
    setLocationState({ kind: "folder", path: relPath });
  }, []);

  const handleFocusFolder = useCallback(
    (relPath: string) => {
      // Open it in the file panel too, so a folder click both shows what is
      // inside and points the graph at it.
      setRevealRequest((prev) => ({
        path: relPath,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      const scope = location.kind === "folder" ? location.path : null;
      const inScope =
        scope !== null &&
        (scope === "" ? relPath !== "" : relPath.startsWith(`${scope}/`));
      if (inScope) {
        setFocusRequest((prev) => ({ id: relPath, nonce: (prev?.nonce ?? 0) + 1 }));
      } else {
        handleSelectFolder(relPath);
      }
    },
    [location, handleSelectFolder]
  );

  const showDocs = Boolean((codeFile && docFile) || aiResult) && !docsCollapsed;
  const mainFile = showDocs && !aiResult ? codeFile : (codeFile ?? docFile);
  const isPathLocation = location.kind === "folder" || location.kind === "code";

  // What a Task may be pointed at. Which of it is chosen happens in the panel:
  // the Scope, a set of files in it, or Definitions in the open file.
  /** The definition selected in the file graph, which the AI panel's
   *  Relationship section follows. */
  const [graphSelection, setGraphSelection] = useState<string | null>(null);
  const handleGraphSelection = useCallback((id: string | null) => {
    // A cleared canvas keeps the last selection: panning away should not empty
    // the panel.
    if (id) {
      setGraphSelection(id);
    }
  }, []);

  /** The block selected in the folder graph, which the Relationship section
   *  follows the same way it follows the file graph. */
  const [projectSelection, setProjectSelection] = useState<string | null>(null);
  const handleProjectSelection = useCallback((id: string | null) => {
    if (id) {
      setProjectSelection(id);
    }
  }, []);

  const aiScope = useMemo(() => {
    if (location.kind === "folder") {
      return location.path;
    }
    if (location.kind === "code") {
      const slash = location.path.lastIndexOf("/");
      return slash > 0 ? location.path.slice(0, slash) : "";
    }
    return "";
  }, [location]);
  const aiFile = location.kind === "code" ? location.path : null;

  const handleAiResult = useCallback((request: AiRequest, result: AiSummary) => {
    setAiRequest(request);
    setAiResult(result);
    // Remember it per request, so the panel can highlight what is already
    // generated and show it again without asking anyone.
    setAiResults((previous) => ({ ...previous, [requestKey(request)]: { request, result } }));
    setDocsCollapsed(false);
  }, []);

  const showAiResult = useCallback((request: AiRequest, result: AiSummary) => {
    setAiRequest(request);
    setAiResult(result);
    setDocsCollapsed(false);
  }, []);

  const regenerateAi = useCallback(async () => {
    if (!aiRequest) {
      return;
    }
    handleAiResult(aiRequest, await aiSummary({ ...aiRequest, force: true }));
  }, [aiRequest, handleAiResult]);

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
          onOpenAi={() => setAiOpen((value) => !value)}
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
      <div className="relative h-full bg-bg">
      <EmphasisProvider value={{ emphasis, setEmphasis }}>
      {aiOpen && (
        <AiPanel
          root={root}
          scope={aiScope}
          file={aiFile}
          selectedDefinitionId={graphSelection}
          selectedProjectId={projectSelection}
          results={aiResults}
          onResult={handleAiResult}
          onShow={showAiResult}
          onHover={(row) => setEmphasis(row ? { ids: row.nodes } : null)}
          onClose={() => setAiOpen(false)}
        />
      )}
      <Group orientation="horizontal" onLayoutChanged={handleLayoutChanged}>
        {/* One collapsible panel rather than a swap, so collapsing and showing
            again returns to the width the user dragged it to. */}
        <Panel
          id="explorer"
          panelRef={explorerPanel}
          collapsible
          collapsedSize="40px"
          defaultSize="20%"
          minSize="10%"
          className="border-r border-white/10"
        >
          {explorerCollapsed ? (
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
          ) : (
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
                    onFocusFolder={handleFocusFolder}
                    selectedFile={isPathLocation ? location.path : selectedFile}
                    revealFolder={revealRequest}
                  />
                </div>
            </div>
          )}
        </Panel>
        <Separator className="w-1 bg-white/10 transition-colors hover:bg-accent/50" />

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
                  state={projectState}
                  onNavigate={setLocationState}
                  focus={focusRequest ?? undefined}
                  onSelect={handleProjectSelection}
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
              <ContentPane
                root={root}
                filePath={mainFile}
                initialSelectedId={
                  location.kind === "code" ? location.select ?? null : null
                }
                onSelect={handleGraphSelection}
              />
            )}
          </div>
          {((codeFile && docFile) || aiResult) && docsCollapsed && (
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
            <Separator className="w-1 bg-white/10 transition-colors hover:bg-accent/50" />
            <Panel defaultSize="40%" minSize="15%">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
                  <span className="text-[10px] uppercase tracking-wider text-dimmed">
                    {aiResult ? "AI" : "Docs"}
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
                  {aiResult ? (
                    <AiResultView
                      root={root}
                      result={aiResult}
                      onRegenerate={regenerateAi}
                      onClose={() => setAiResult(null)}
                    />
                  ) : (
                    <ContentPane root={root} filePath={docFile} />
                  )}
                </div>
              </div>
            </Panel>
          </>
        )}
      </Group>
      </EmphasisProvider>
      </div>
      )}
        </div>
      </div>
    </SearchProvider>
  );
}
