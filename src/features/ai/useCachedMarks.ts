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
    let failure: unknown = null;

    // The first probe is immediate: opening the panel should answer at once. Later
    // ones wait, so ticking three definitions is one round instead of three.
    const delay = probed.current ? DEBOUNCE_MS : 0;
    probed.current = true;

    setChecking(true);
    const timer = setTimeout(
      () => {
        Promise.all(
          // One call per request, so an option whose Digest is quick is marked the
          // moment it lands rather than waiting for the slowest in the batch.
          asked.map((request) =>
            aiCached(root, [request])
              .then((found) => {
                const key = requestSignature(request);
                if (!cancelled) {
                  setMarks((previous) => ({ ...previous, [key]: found[0] === true }));
                }
              })
              .catch((reason: unknown) => {
                // A probe is a hint: one that cannot run leaves no mark and keeps
                // every option available.
                failure = failure ?? reason;
              })
          )
        ).then(() => {
          if (cancelled) {
            return;
          }
          if (failure) {
            // Logged, because a probe that cannot run at all — a command the
            // running build does not have — would otherwise be invisible: the panel
            // would simply look as if nothing had ever been generated.
            console.warn("could not ask the store what is already generated", failure);
            setMarks({});
          }
          setChecking(false);
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
