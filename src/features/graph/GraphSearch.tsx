import { useEffect, useRef, useState } from "react";

export interface SearchItem {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  items: SearchItem[];
  onPick: (id: string) => void;
  placeholder?: string;
}

/**
 * Floating search box for a graph. Opens with Ctrl/Cmd+F (or the button),
 * closes with Escape, filters by substring, and picks with click or Enter.
 */
export function GraphSearch({ items, onPick, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const trimmed = query.trim().toLowerCase();
  const results = trimmed
    ? items
        .filter((item) => item.label.toLowerCase().includes(trimmed))
        .slice(0, 30)
    : [];

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (Ctrl+F)"
        className="absolute right-3 top-3 z-20 rounded border border-accent/40 bg-panel px-2 py-1 text-xs text-accent hover:bg-accent/10"
      >
        Search
      </button>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-30 w-72 rounded border border-accent/40 bg-panel p-2 shadow-lg">
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && results[0]) {
            pick(results[0].id);
          }
        }}
        placeholder={placeholder ?? "Search…"}
        className="w-full rounded border border-white/15 bg-bg px-2 py-1 text-xs text-white outline-none focus:border-accent"
      />
      {query.trim().length > 0 && (
        <ul className="m-0 mt-1 max-h-64 list-none overflow-auto p-0">
          {results.length === 0 ? (
            <li className="px-1 py-1 text-xs text-dimmed">no matches</li>
          ) : (
            results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => pick(item.id)}
                  title={item.id}
                  className="block w-full truncate px-1 py-1 text-left text-xs text-white/85 hover:bg-accent/10"
                >
                  {item.hint && (
                    <span className="mr-1 text-[10px] uppercase tracking-wider text-dimmed">
                      {item.hint}
                    </span>
                  )}
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
