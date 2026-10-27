import { useEffect, useRef, useState } from "react";
import { aiCached, type AiRequest } from "../../shared/ipc";
import { requestSignature } from "./requests";

/** Long enough that ticking three definitions is one round of probing, short
 *  enough that it does not feel like a pause. */
const DEBOUNCE_MS = 250;

export interface CachedMarks {
  marks: Record<string, boolean>;
  /** True while the store is still being asked, so the wait can be shown. */
  checking: boolean;
}

/**
 * Which of these requests the store can already answer, by request signature.
 *
 * Nothing is saved to make a mark: the Summary Cache is the record, and asking it
 * the same way a click would is what lets the panel forget everything on restart
 * and still come back showing what is already generated.
 */
export function useCachedMarks(root: string | null, requests: AiRequest[]): CachedMarks {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const latest = useRef(requests);
  latest.current = requests;
  const probed = useRef(false);
  const signature = requests.map(requestSignature).join("\n");

  useEffect(() => {
    if (!root || signature === "") {
      setMarks({});
      setChecking(false);
      return;
    }

    let cancelled = false;
    const asked = latest.current;

    // The first probe is immediate: opening the panel should answer at once. Later
    // ones wait, so ticking three definitions is one round instead of three.
    const delay = probed.current ? DEBOUNCE_MS : 0;
    probed.current = true;

    setChecking(true);
    const timer = setTimeout(
      () => {
        // The whole batch is one call. Rust answers it from a single scan of the
        // project, and asking per request made the panel's own questions the
        // slowest thing in the app — a folder with many rows meant hundreds of
        // walks. Marks now land together instead of one at a time.
        aiCached(root, asked)
          .then((found) => {
            if (cancelled) {
              return;
            }
            const next: Record<string, boolean> = {};
            asked.forEach((request, index) => {
              next[requestSignature(request)] = found[index] === true;
            });
            setMarks(next);
          })
          .catch((reason: unknown) => {
            if (cancelled) {
              return;
            }
            // Logged, because a probe that cannot run at all — a command the
            // running build does not have — would otherwise be invisible: the panel
            // would simply look as if nothing had ever been generated.
            console.warn("could not ask the store what is already generated", reason);
            setMarks({});
          })
          .finally(() => {
            if (!cancelled) {
              setChecking(false);
            }
          });
      },
      delay
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [root, signature]);

  return { marks, checking };
}
