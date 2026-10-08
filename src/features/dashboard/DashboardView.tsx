import type { ProjectGraph } from "../../shared/types";
import type { LoadState } from "../shell/useAsyncLoad";
import { EmptyState, ErrorState } from "../../shared/StateViews";
import { colorForNode, PALETTE } from "../graph/colors";
import { formatBytes, summariseProject } from "./summary";
import { Bars, Donut, Split } from "./Charts";

interface Props {
  state: LoadState<ProjectGraph>;
  onOpenGraph: () => void;
  onOpenAi: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** What a project is made of, at a glance. Read-only: everything here is derived
 *  from the project graph the canvas already needs. */
export function DashboardView({ state, onOpenGraph, onOpenAi }: Props) {
  if (state.status === "idle" || state.status === "loading") {
    return <EmptyState message="reading the project…" />;
  }
  if (state.status === "error") {
    return <ErrorState message={state.message} />;
  }
  return <Dashboard graph={state.value} onOpenGraph={onOpenGraph} onOpenAi={onOpenAi} />;
}

function Dashboard({
  graph,
  onOpenGraph,
  onOpenAi,
}: {
  graph: ProjectGraph;
  onOpenGraph: () => void;
  onOpenAi: () => void;
}) {
  const summary = summariseProject(graph);

  // An empty project measures zero bytes, so the ratio falls back to file counts
  // and says which measure it used rather than drawing an empty ring.
  const byBytes = summary.bytes > 0;
  const measure = byBytes ? "bytes" : "file count";
  const slices = summary.languages.map((entry) => ({
    label: entry.language,
    share: byBytes
      ? entry.share
      : summary.files > 0
        ? entry.files / summary.files
        : 0,
    color: colorForNode(entry.language),
  }));
  const ratioLabel =
    slices.length === 0
      ? "Language ratio: no files"
      : `Language ratio by ${measure}: ${slices
          .map((slice) => `${slice.label} ${percent(slice.share)}`)
          .join(", ")}`;

  const languageBars = summary.languages.map((entry) => ({
    label: entry.language,
    value: byBytes ? entry.bytes : entry.files,
    display: byBytes
      ? formatBytes(entry.bytes)
      : `${entry.files} ${entry.files === 1 ? "file" : "files"}`,
    color: colorForNode(entry.language),
  }));
  const largestMax = summary.largestFiles[0]?.bytes ?? 0;

  return (
    <div className="h-full overflow-auto bg-bg p-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-medium text-white">
              {baseName(graph.root)}
            </h1>
            <p className="truncate text-xs text-dimmed" title={graph.root}>
              {graph.root}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onOpenGraph}
              className="rounded border border-white/15 px-2.5 py-1 text-xs text-white/85 hover:border-accent/50 hover:text-accent"
            >
              View graph
            </button>
            <button
              type="button"
              onClick={onOpenAi}
              className="rounded border border-white/15 px-2.5 py-1 text-xs text-white/85 hover:border-accent/50 hover:text-accent"
            >
              Summarise this project
            </button>
          </div>
        </header>

        {summary.truncated && (
          <p className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            This project is larger than one scan, so these numbers describe the first part of it.
          </p>
        )}

        <section className="rounded border border-white/10 bg-panel p-4">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-dimmed">Totals</h2>
          <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Files", String(summary.files)],
              ["Folders", String(summary.folders)],
              ["Size", formatBytes(summary.bytes)],
              ["Import edges", String(summary.edges)],
            ].map(([term, value]) => (
              <div key={term}>
                <dt className="text-[10px] uppercase tracking-wider text-dimmed">{term}</dt>
                <dd className="m-0 text-base text-white">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[10px] uppercase tracking-wider text-dimmed">
              <span>Code {summary.codeFiles}</span>
              <span>Docs {summary.docFiles}</span>
            </div>
            <Split
              label={`Code and docs: ${summary.codeFiles} code files, ${summary.docFiles} doc files`}
              parts={[
                { label: "code", value: summary.codeFiles, color: PALETTE[0] },
                { label: "docs", value: summary.docFiles, color: PALETTE[2] },
              ]}
            />
          </div>
          {summary.externalFiles > 0 && (
            <p className="mt-3 text-[11px] text-dimmed">
              {summary.externalFiles} imported {summary.externalFiles === 1 ? "file" : "files"} outside
              this folder are left out of these numbers.
            </p>
          )}
        </section>

        <section className="rounded border border-white/10 bg-panel p-4">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-dimmed">
            Languages by {measure}
          </h2>
          {slices.length === 0 ? (
            <p className="text-xs text-dimmed">No files to measure.</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <Donut slices={slices} label={ratioLabel} />
              <div className="w-full min-w-0 flex-1">
                <Bars
                  items={languageBars}
                  max={languageBars.reduce((max, item) => Math.max(max, item.value), 0)}
                  label={`Languages by ${measure}: ${summary.languages
                    .map((entry) => `${entry.language} ${entry.files} files`)
                    .join(", ")}`}
                />
                <ul className="m-0 mt-3 list-none space-y-1 p-0">
                  {summary.languages.map((entry) => (
                    <li key={entry.language} className="flex items-center gap-2 text-xs">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: colorForNode(entry.language) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-white/85">{entry.language}</span>
                      <span className="text-dimmed">{percent(entry.share)}</span>
                      <span className="w-16 text-right text-dimmed">
                        {entry.files} {entry.files === 1 ? "file" : "files"}
                      </span>
                      <span className="w-16 text-right text-dimmed">{formatBytes(entry.bytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <section className="rounded border border-white/10 bg-panel p-4">
            <h2 className="mb-3 text-xs uppercase tracking-wider text-dimmed">Largest files</h2>
            {summary.largestFiles.length === 0 ? (
              <p className="text-xs text-dimmed">No files to measure.</p>
            ) : (
              <Bars
                items={summary.largestFiles.map((entry) => ({
                  label: entry.path,
                  value: entry.bytes,
                  display: formatBytes(entry.bytes),
                  color: PALETTE[1],
                }))}
                max={largestMax}
                label={`Largest files: ${summary.largestFiles
                  .map((entry) => `${entry.path} ${formatBytes(entry.bytes)}`)
                  .join(", ")}`}
              />
            )}
          </section>

          <section className="rounded border border-white/10 bg-panel p-4">
            <h2 className="mb-3 text-xs uppercase tracking-wider text-dimmed">Entry points</h2>
            {summary.entryPoints.length === 0 ? (
              <p className="text-xs text-dimmed">None detected.</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {summary.entryPoints.map((entry) => (
                  <li key={entry} className="truncate text-xs text-white/85" title={entry}>
                    {entry}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
