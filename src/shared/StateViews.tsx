export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <p className="text-dimmed">{message}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <p className="max-w-lg text-center text-red-400">{message}</p>
    </div>
  );
}

/**
 * A question that costs a walk of the whole project, asked only when the reader
 * asks it. The warning is part of the control: a button that silently takes
 * seconds reads as a broken app.
 */
export function GenerateGate({
  warning,
  action,
  onGenerate,
}: {
  warning: string;
  action: string;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded border border-accent/30 bg-panel p-2">
      <p className="m-0 text-[11px] leading-snug text-white/85">{warning}</p>
      <button
        type="button"
        onClick={onGenerate}
        className="mt-2 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
      >
        {action}
      </button>
    </div>
  );
}
