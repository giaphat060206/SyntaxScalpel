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
    // Storage unavailable: the choice simply does not persist.
  }
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
  }, [provider]);

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
    },
    [provider]
  );

  const clearKey = useCallback(async () => {
    const settings = await clearAiKey(provider);
    setHasKey(settings.hasKey);
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
