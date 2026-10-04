import type { AiRequest, AiSummary } from "../../shared/ipc";
import { directionKind, type ConnectionRow } from "./relationships";
import { requestKey, requestSignature, sameRequest } from "./requests";

interface Props {
  root: string;
  rows: ConnectionRow[];
  loading: boolean;
  error: string | null;
  /** What has already been generated this session, by request key. */
  results: Record<string, { request: AiRequest; result: AiSummary }>;
  /** What the store can already answer, by request signature: derived, not saved. */
  marks: Record<string, boolean>;
  /** True while the store is still being asked, so no row can be acted on yet. */
  busy: boolean;
  /** What to say when there is nothing to list, which is not always "nothing". */
  empty: string;
  /** Anything the listing has to admit, such as being cut short by its cap. */
  note?: string | null;
  provider: string;
  model: string;
  onGenerate: (row: ConnectionRow) => void;
  onShow: (request: AiRequest, result: AiSummary) => void;
  onHover: (row: ConnectionRow | null) => void;
}

const chip = "shrink-0 rounded border px-1 text-[10px] uppercase tracking-wider";
/** Accent for what this side reaches, mint for what reaches it — the same split
 *  the project graph's info card already uses. */
const chipTone = {
  outbound: "border-accent/40 text-accent",
  inbound: "border-mint/40 text-mint",
} as const;

/**
 * A target's relationships: one row per counterpart, and nothing more. The row
 * carries no summary — the answer belongs in the result pane like every other
 * Task's — but it does say whether one already exists.
 */
export function RelationshipList({
  root,
  rows,
  loading,
  error,
  results,
  marks,
  busy,
  empty,
  note,
  provider,
  model,
  onGenerate,
  onShow,
  onHover,
}: Props) {
  if (error) {
    return <p className="m-0 text-xs text-red-400">{error}</p>;
  }
  if (loading) {
    return <p className="m-0 text-xs text-dimmed">following the graph…</p>;
  }
  if (rows.length === 0) {
    return <p className="m-0 text-xs text-dimmed">{empty}</p>;
  }

  return (
    <div>
      <ul className="m-0 max-h-48 list-none space-y-0.5 overflow-auto p-0">
        {rows.map((row) => {
          const request: AiRequest = {
            root,
            target: { kind: "connection", source: row.source, target: row.target },
            task: "relationship",
            provider,
            model,
          };
          const stored = results[requestKey(request)];
          const done =
            Boolean(stored && sameRequest(stored.request, request)) ||
            marks[requestSignature(request)] === true;
          return (
            <li
              key={`${row.direction}:${row.source}->${row.target}`}
              className="flex items-start gap-1"
              onMouseEnter={() => onHover(row)}
              onMouseLeave={() => onHover(null)}
            >
              <span className={`${chip} ${chipTone[directionKind(row.direction)]}`}>
                {row.direction}
              </span>
              <span className="min-w-0 flex-1 break-all text-xs text-white/85" title={row.label}>
                {row.label}
              </span>
            <button
              type="button"
              disabled={busy}
              aria-pressed={done}
              title={
                busy
                  ? "Checking the store for what is already generated"
                  : done
                    ? "Already generated: click to show it again"
                    : `Explain how these interact`
              }
              onClick={() => (done && stored ? onShow(stored.request, stored.result) : onGenerate(row))}
              className={`shrink-0 rounded border px-1 py-0.5 text-[11px] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/85 ${
                done
                  ? "border-accent/60 bg-accent/10 text-accent hover:bg-accent/20"
                  : "border-white/10 text-white/85 hover:border-accent/40 hover:text-accent"
              }`}
            >
              {done ? "✓ Show" : "Generate"}
            </button>
          </li>
        );
      })}
      </ul>
      {note && <p className="m-0 mt-1 text-[11px] text-dimmed">{note}</p>}
    </div>
  );
}
