import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportSummary, type AiSummary } from "../../shared/ipc";
import { MarkdownView } from "../markdown/MarkdownView";

interface Props {
  root: string | null;
  result: AiSummary;
  onRegenerate: () => Promise<void>;
  onClose: () => void;
}

const action =
  "rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-40";

/** Where the answer came from and what it cost, in one line. */
export function cacheLabel(result: AiSummary, now: number): string {
  const age = Math.max(0, now - result.createdAtMs);
  const minutes = Math.floor(age / 60_000);
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes} min ago`
        : minutes < 60 * 24
          ? `${Math.floor(minutes / 60)} h ago`
          : `${Math.floor(minutes / (60 * 24))} d ago`;
  const tokens = result.inputTokens + result.outputTokens;
  return `${result.cached ? "cached" : "fresh"} · ${result.provider} · ${result.model} · ${when}${
    tokens > 0 ? ` · ${tokens} tokens` : ""
  }${result.truncated ? " · digest truncated" : ""}`;
}

/** A readable default filename; the model id carries slashes, which no path may. */
export function exportName(result: AiSummary): string {
  return `${result.task}-${result.model.replace(/[^a-zA-Z0-9.-]+/g, "-")}.md`;
}

export function AiResultView({ root, result, onRegenerate, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRegenerate();
    } catch (reason: unknown) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const exportAs = async () => {
    if (!root) {
      return;
    }
    setError(null);
    setNote(null);
    try {
      const chosen = await save({
        defaultPath: exportName(result),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof chosen !== "string") {
        return;
      }
      setExporting(true);
      await exportSummary(root, result.key, chosen);
      setNote(`Exported to ${chosen.split(/[\\/]/).pop()}`);
    } catch (reason: unknown) {
      setError(String(reason));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1">
        <span className="min-w-0 truncate text-[10px] uppercase tracking-wider text-dimmed">
          {cacheLabel(result, Date.now())}
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            title="Ask again, ignoring the cache"
            className={action}
          >
            {busy ? "Asking…" : "Regenerate"}
          </button>
          <button
            type="button"
            onClick={exportAs}
            disabled={exporting || root === null}
            title="Save this summary as Markdown"
            className={action}
          >
            {exporting ? "Saving…" : "Export"}
          </button>
          <button type="button" onClick={onClose} title="Dismiss" className={action}>
            Dismiss
          </button>
        </span>
      </div>
      {note && <p className="m-0 px-2 py-1 text-xs text-dimmed">{note}</p>}
      {error && <p className="m-0 px-2 py-1 text-xs text-red-400">{error}</p>}
      <div className="min-h-0 flex-1">
        <MarkdownView content={result.text} />
      </div>
    </div>
  );
}
