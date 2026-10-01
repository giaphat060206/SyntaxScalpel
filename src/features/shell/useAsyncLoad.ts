import { useEffect, useState } from "react";

export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

export function useAsyncLoad<T>(
  key: string | null,
  load: (() => Promise<T>) | null
): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "idle" });

  useEffect(() => {
    if (key === null || load === null) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    load()
      .then((value) => {
        if (!cancelled) {
          setState({ status: "ready", value });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
