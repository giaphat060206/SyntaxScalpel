import { useState } from "react";
import { PROVIDERS, useAiSettings } from "./useAiSettings";

// A solid background, matching the panel's own fields. The provider list is drawn by
// the platform, and a transparent select gives white text on the popup's own light
// background: unreadable options in the one control that names where code goes.
const FIELD =
  "min-w-0 flex-1 rounded border border-white/15 bg-bg px-2 py-1 text-xs text-white/90 outline-none focus:border-accent";
const ACTION =
  "shrink-0 rounded border border-white/15 px-2 py-1 text-[11px] text-white/85 hover:border-accent/50 hover:text-accent";

/**
 * The three things that decide where a request goes: provider, model, and the key
 * for that provider. One implementation, used by the AI panel and the top-bar menu,
 * so a change made in either is a change made in both — they share the settings
 * store, they do not each keep a copy.
 *
 * The key is write-only. Rust reports only whether one exists, and this field never
 * renders a stored key back: there is nothing to render, and that is the invariant.
 */
export function AiConnectionFields() {
  const settings = useAiSettings();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const label =
    PROVIDERS.find((entry) => entry.id === settings.provider)?.label ?? settings.provider;

  const save = async () => {
    const key = draft.trim();
    if (key === "") {
      return;
    }
    try {
      await settings.saveKey(key);
      setDraft("");
      setError(null);
    } catch (reason: unknown) {
      setError(String(reason));
    }
  };

  return (
    <div className="space-y-2">
      <select
        aria-label="Provider"
        value={settings.provider}
        onChange={(event) => settings.setProvider(event.target.value)}
        className={`${FIELD} w-full`}
      >
        {PROVIDERS.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.label}
          </option>
        ))}
      </select>

      <input
        aria-label="Model"
        value={settings.model}
        placeholder={PROVIDERS.find((entry) => entry.id === settings.provider)?.defaultModel}
        onChange={(event) => settings.setModel(event.target.value)}
        className={`${FIELD} w-full`}
      />

      <div className="flex items-center gap-1">
        <input
          aria-label="API key"
          type="password"
          value={draft}
          placeholder={settings.hasKey ? "key saved" : "paste a key"}
          onChange={(event) => setDraft(event.target.value)}
          className={FIELD}
        />
        <button type="button" onClick={() => void save()} className={ACTION}>
          Save
        </button>
        {settings.hasKey && (
          <button type="button" onClick={() => void settings.clearKey()} className={ACTION}>
            Clear
          </button>
        )}
      </div>

      <p className="text-[10px] text-dimmed">
        {settings.hasKey
          ? `A ${label} key is in the OS keyring, and is never sent back to this window.`
          : `No ${label} key yet.`}
      </p>
      {error !== null && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
