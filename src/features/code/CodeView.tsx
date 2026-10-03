import { useMemo, useState } from "react";
import { highlightCode, languageForPath } from "./highlight";

interface Props {
  /** Full file text. */
  code: string;
  /** Project-relative path of the file, used for the language and title. */
  filePath: string;
  /** 1-based inclusive range of the section to show (whole file when absent). */
  startLine?: number;
  endLine?: number;
  /** Name of the selected definition, shown in the header. */
  title?: string;
  /** Collapses the pane back to the graph. */
  onCollapse?: () => void;
}

export function CodeView({
  code,
  filePath,
  startLine,
  endLine,
  title,
  onCollapse,
}: Props) {
  const [wrap, setWrap] = useState(false);

  const { section, firstLine } = useMemo(() => {
    const lines = code.split("\n");
    const from = Math.max(1, startLine ?? 1);
    const to = Math.min(lines.length, endLine ?? lines.length);
    return {
      section: lines.slice(from - 1, to).join("\n"),
      firstLine: from,
    };
  }, [code, startLine, endLine]);

  const html = useMemo(
    () => highlightCode(section, languageForPath(filePath)),
    [section, filePath]
  );
  const lineNumbers = useMemo(
    () => section.split("\n").map((_, index) => firstLine + index),
    [section, firstLine]
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1">
        <span className="min-w-0 truncate font-mono text-xs text-accent">
          {title ? `${title} — ` : ""}
          {filePath}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-dimmed">
            {startLine !== undefined && endLine !== undefined
              ? `L${startLine}–${endLine}`
              : `${lineNumbers.length} lines`}
          </span>
          <button
            type="button"
            onClick={() => setWrap((value) => !value)}
            title={wrap ? "Disable line wrap" : "Wrap long lines"}
            className={
              "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
              (wrap
                ? "border-accent/60 text-accent"
                : "border-white/15 text-dimmed hover:text-accent")
            }
          >
            Wrap
          </button>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse code view"
              className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-dimmed hover:text-accent"
            >
              »
            </button>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-w-full font-mono text-[12px] leading-5">
          <pre className="m-0 select-none bg-panel px-3 py-2 text-right text-dimmed">
            {lineNumbers.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </pre>
          <pre
            className={
              "m-0 flex-1 px-3 py-2 text-white/90 " +
              (wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto")
            }
          >
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        </div>
      </div>
    </div>
  );
}
