import { useEffect, useRef, useState } from "react";
import { aiCached, type AiRequest } from "../../shared/ipc";
import { requestSignature } from "./requests";

/** The probe rebuilds a Digest per request, and a user ticking definitions should
 *  not pay for every click, so marks arrive shortly after the target settles. */
const DEBOUNCE_MS = 350;

/**
 * Which of these requests the store can already answer, by request signature.
 *
 * Nothing is saved to make a mark: the Summary Cache is the record, and asking it
 * the same way a click would is what lets the panel forget everything on restart
 * and still come back showing what is already generated.
 */
export function useCachedMarks(
  root: string | null,
  requests: AiRequest[]
): Record<string, boolean> {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const latest = useRef(requests);
  latest.current = requests;
  const signature = requests.map(requestSignature).join("\n");

  useEffect(() => {
    if (!root || signature === "") {
      setMarks({});
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const asked = latest.current;
      aiCached(root, asked)
        .then((found) => {
          if (cancelled) {
            return;
          }
          setMarks(
            Object.fromEntries(
              asked.map((request, index) => [requestSignature(request), found[index] === true])
            )
          );
        })
        .catch(() => {
          // A probe is a hint: if it cannot run, no mark is shown and every Task
          // stays available.
          if (!cancelled) {
            setMarks({});
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [root, signature]);

  return marks;
}
