import { useCallback, useEffect, useState } from "react";
import { aiSettings, clearAiKey, setAiKey } from "../../shared/ipc";

export interface ProviderChoice {
  id: string;
  label: string;
  defaultModel: string;
}

export const PROVIDERS: ProviderChoice[] = [
  { id: "openrouter", label: "OpenRouter", defaultModel: "deepseek/deepseek-chat" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
];

const PROVIDER_KEY = "scalpel.aiProvider";
const MODEL_KEY = "scalpel.aiModel";

/**
 * One shared pair of preferences, not one per caller. The AI panel changes the
 * provider; the tour, mounted in the shell from the start, has to see that without
 * the app being restarted — so every change is announced and every instance
 * re-reads.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of listeners) {
    listener();
  }
}

function read(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice does not persist, but it still applies now.
  }
  announce();
}

/**
 * Provider and model are preferences, so they live here beside the recents list.
 * The Provider Key does not: Rust holds it and only reports whether one exists.
 */
export function useAiSettings() {
  const [provider, setProviderState] = useState(() => {
    const stored = read(PROVIDER_KEY, PROVIDERS[0].id);
    return PROVIDERS.some((choice) => choice.id === stored) ? stored : PROVIDERS[0].id;
  });
  const [model, setModelState] = useState(() => read(MODEL_KEY, ""));
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when anyone changes a preference or a key, so this instance re-reads the
  // preferences and asks Rust again about the key that belongs to them.
  const [revision, setRevision] = useState(0);

  useEffect(
    () =>
      subscribe(() => {
        const stored = read(PROVIDER_KEY, PROVIDERS[0].id);
        setProviderState(
          PROVIDERS.some((choice) => choice.id === stored) ? stored : PROVIDERS[0].id
        );
        setModelState(read(MODEL_KEY, ""));
        setRevision((value) => value + 1);
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    aiSettings(provider)
      .then((settings) => {
        if (!cancelled) {
          setHasKey(settings.hasKey);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setHasKey(false);
          setError(String(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, revision]);

  const setProvider = useCallback((id: string) => {
    setProviderState(id);
    write(PROVIDER_KEY, id);
  }, []);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    write(MODEL_KEY, value);
  }, []);

  const saveKey = useCallback(
    async (key: string) => {
      const settings = await setAiKey(provider, key);
      setHasKey(settings.hasKey);
      setError(null);
      // Another surface may be holding the answer to "is there a key?" for this
      // provider — the tour shows its Explain button on that answer.
      announce();
    },
    [provider]
  );

  const clearKey = useCallback(async () => {
    const settings = await clearAiKey(provider);
    setHasKey(settings.hasKey);
    announce();
  }, [provider]);

  return {
    provider,
    setProvider,
    model,
    setModel,
    hasKey,
    ready: hasKey,
    saveKey,
    clearKey,
    error,
    setError,
  };
}
