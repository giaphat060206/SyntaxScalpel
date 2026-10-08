import { useEffect } from "react";
import { MarkdownView } from "../markdown/MarkdownView";
import type { TourPlan, TourStep } from "./plan";
import type { TourProseApi } from "./useTourProse";

interface Props {
  plan: TourPlan | null;
  steps: TourStep[];
  index: number;
  /** The folder being toured, so the panel says which one. */
  scopePath: string;
  /**
   * Asking for prose, and the notice that guards it. Optional on purpose: the plan
   * is the tour, so a panel without prose is a tour without explanations rather
   * than a broken one — which is exactly what a project with no key gets.
   */
  prose?: TourProseApi;
  onGoTo: (index: number) => void;
  onClose: () => void;
}

const KIND: Record<TourStep["kind"], string> = {
  orientation: "Start here",
  entry: "Entry point",
  module: "Module",
};

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** What this stop is, in the terms the plan actually knows: how far it is from the
 *  entry, and how much code leans on it. Never an invented description. */
function describe(step: TourStep): string {
  const parts = [
    step.depth === null
      ? "not reached from the entry"
      : step.depth === 0
        ? "where the program starts"
        : `${step.depth} hop${step.depth === 1 ? "" : "s"} from the entry`,
  ];
  if (step.dependents > 0) {
    parts.push(`${step.dependents} file${step.dependents === 1 ? "" : "s"} import this`);
  }
  return parts.join(" · ");
}

export function TourPanel({ plan, steps, index, scopePath, prose, onGoTo, onClose }: Props) {
  const atStart = index === 0;
  const atEnd = steps.length === 0 || index >= steps.length - 1;

  // Arrow keys: a tour is a sequence, and reaching for the mouse at every step is
  // the wrong shape for one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        onGoTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        onGoTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, onGoTo]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-white/85" title={scopePath}>
            Tour · {baseName(scopePath)}
          </p>
          <p className="text-[11px] text-dimmed">A suggested reading order, not documentation.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 hover:border-accent/50 hover:text-accent"
        >
          Close
        </button>
      </header>

      {prose?.pending != null && (
        <div className="border-b border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
          <p>
            This sends a digest of <strong>{prose.pending}</strong> to{" "}
            <strong>{prose.providerLabel}</strong>. It leaves this machine.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => void prose.confirm()}
              className="rounded border border-amber-300/40 px-2 py-0.5 text-[11px] hover:bg-amber-400/20"
            >
              Send to {prose.providerLabel}
            </button>
            <button
              type="button"
              onClick={prose.cancel}
              className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {plan?.truncated && (
        <p className="border-b border-white/10 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          {plan.dropped} more {plan.dropped === 1 ? "file" : "files"} would not fit in one tour — open a
          folder and tour that to go deeper.
        </p>
      )}

      <ol className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
        {steps.map((step, position) => (
          <li key={step.nodeId} className="border-b border-white/5">
            <button
              type="button"
              onClick={() => onGoTo(position)}
              aria-current={position === index ? "step" : undefined}
              className={
                position === index
                  ? "block w-full px-3 py-2 text-left text-xs text-accent"
                  : "block w-full px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
              }
            >
              <span className="text-[10px] uppercase tracking-wider text-dimmed">
                {position + 1}. {KIND[step.kind]}
              </span>
              <span className="block break-all text-white/90">{step.nodeId}</span>
              <span className="block text-[11px] text-dimmed">{describe(step)}</span>
            </button>
            {position === index &&
              prose &&
              (() => {
                const state = prose.state[step.nodeId] ?? { status: "idle" as const };
                return (
                  <div className="border-t border-white/5 px-3 py-2">
                    {state.status === "running" && <p className="text-[11px] text-dimmed">asking…</p>}

                    {state.status === "error" && (
                      <div className="space-y-1">
                        <p className="break-words text-[11px] text-red-400">{state.message}</p>
                        <button
                          type="button"
                          onClick={() => void prose.explain(step)}
                          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 hover:border-accent/50 hover:text-accent"
                        >
                          Try again
                        </button>
                      </div>
                    )}

                    {state.status === "ready" && (
                      <div className="space-y-1">
                        {state.prose.title !== "" && (
                          <p className="text-xs text-white/90">{state.prose.title}</p>
                        )}
                        {state.prose.why !== "" && (
                          <div className="text-[11px] text-white/75">
                            <MarkdownView content={state.prose.why} />
                          </div>
                        )}
                        {state.prose.lookAt.length > 0 && (
                          <p className="break-all text-[10px] text-dimmed">
                            also worth opening: {state.prose.lookAt.join(", ")}
                          </p>
                        )}
                        {state.prose.dropped > 0 && (
                          <p className="text-[10px] text-amber-200">
                            {state.prose.dropped} id
                            {state.prose.dropped === 1 ? "" : "s"} it named{" "}
                            {state.prose.dropped === 1 ? "is" : "are"} not in this project, so{" "}
                            {state.prose.dropped === 1 ? "it was" : "they were"} left out.
                          </p>
                        )}
                        {state.cached && (
                          <p className="text-[10px] text-dimmed">
                            already generated — no request was made
                          </p>
                        )}
                      </div>
                    )}

                    {state.status === "idle" &&
                      (prose.needsKey ? (
                        <p className="text-[11px] text-dimmed">
                          Add an API key in the AI panel to have steps explained.
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void prose.explain(step)}
                          disabled={prose.checking}
                          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 enabled:hover:border-accent/50 enabled:hover:text-accent disabled:opacity-40"
                        >
                          {prose.checking ? "checking what is already generated…" : "Explain this step"}
                        </button>
                      ))}
                  </div>
                );
              })()}
          </li>
        ))}
        {steps.length === 0 && (
          <li className="px-3 py-3 text-xs text-dimmed">No code files to tour here.</li>
        )}
      </ol>

      <footer className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => onGoTo(index - 1)}
          disabled={atStart}
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 enabled:hover:border-accent/50 enabled:hover:text-accent disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-[11px] text-dimmed">
          {steps.length === 0 ? "no steps" : `${index + 1} / ${steps.length}`}
        </span>
        <button
          type="button"
          onClick={() => onGoTo(index + 1)}
          disabled={atEnd}
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/85 enabled:hover:border-accent/50 enabled:hover:text-accent disabled:opacity-40"
        >
          Next
        </button>
      </footer>
    </div>
  );
}
