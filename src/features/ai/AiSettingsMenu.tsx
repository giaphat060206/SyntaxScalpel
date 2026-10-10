import { useEffect, useRef, useState } from "react";
import { AiConnectionFields } from "./AiConnectionFields";
import { PROVIDERS, useAiSettings } from "./useAiSettings";

/**
 * Where the provider and key are changed. These are app-wide settings rather than
 * something one panel owns, so they live in the top bar — and the tour, which has no
 * settings of its own, inherits whatever is chosen here.
 *
 * A popover rather than a view: settings have no path and no scope, so they do not
 * belong in `Location`, and a modal would sit over a live canvas.
 */
export function AiSettingsMenu() {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const settings = useAiSettings();
  const label =
    PROVIDERS.find((entry) => entry.id === settings.provider)?.label ?? settings.provider;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const onDown = (event: MouseEvent) => {
      if (host.current !== null && !host.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={host} className="relative">
      <button
        type="button"
        title="AI settings"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded px-2 py-0.5 text-white/85 hover:bg-white/10"
      >
        Settings
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded border border-accent/30 bg-panel/95 p-3 text-xs shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-dimmed">AI settings</span>
            <span className="text-[10px] text-dimmed">{label}</span>
          </div>
          <AiConnectionFields />
          <p className="mt-2 text-[10px] text-dimmed">
            Used by every AI task, and by the tour.
          </p>
        </div>
      )}
    </div>
  );
}
