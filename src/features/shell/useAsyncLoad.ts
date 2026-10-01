import { useEffect, useRef, useState } from "react";

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
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const run = loadRef.current;
    if (key === null || run === null) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    run()
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
