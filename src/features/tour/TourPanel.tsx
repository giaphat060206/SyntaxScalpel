import { useEffect } from "react";
import type { TourPlan, TourStep } from "./plan";

interface Props {
  plan: TourPlan | null;
  steps: TourStep[];
  index: number;
  /** The folder being toured, so the panel says which one. */
  scopePath: string;
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

export function TourPanel({ plan, steps, index, scopePath, onGoTo, onClose }: Props) {
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
