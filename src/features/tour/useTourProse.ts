import { useCallback, useMemo, useState } from "react";
import { aiSummary, type AiSummary } from "../../shared/ipc";
import type { ProjectGraph } from "../../shared/types";
import { isConfirmed, rememberConfirmed } from "../ai/egress";
import { requestSignature } from "../ai/requests";
import { PROVIDERS, useAiSettings } from "../ai/useAiSettings";
import { useCachedMarks } from "../ai/useCachedMarks";
import type { TourStep } from "./plan";
import { knownNodeIds, parseTourStop, tourStopRequest, type TourProse } from "./prose";

export type TourProseState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ready"; prose: TourProse; cached: boolean }
  | { status: "error"; message: string };

export interface TourProseApi {
  /** Per step, so one step's failure cannot blank the rest of the tour. */
  state: Record<string, TourProseState>;
  cached: (nodeId: string) => boolean;
  checking: boolean;
  needsKey: boolean;
  /** Named in the notice, which is not allowed to be vague about where code goes. */
  providerLabel: string;
  /** The step whose request is waiting for the egress notice to be agreed. */
  pending: string | null;
  explain: (step: TourStep) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

/**
 * One request per step, on the terms the AI panel already works on: the digest and
 * the layers are Rust's business, a stored answer is read from this machine and so
 * skips the notice, and anything that would actually reach the provider asks first.
 * The tour adds no second way out of the machine.
 */
export function useTourProse(
  root: string,
  scope: string,
  graph: ProjectGraph | null,
  steps: TourStep[]
): TourProseApi {
  const settings = useAiSettings();
  const [state, setState] = useState<Record<string, TourProseState>>({});
  const [pending, setPending] = useState<string | null>(null);

  const known = useMemo(
    () => (graph ? knownNodeIds(graph) : new Set<string>()),
    [graph]
  );

  const requestFor = useCallback(
    (nodeId: string) =>
      tourStopRequest({
        root,
        scope,
        nodeId,
        provider: settings.provider,
        model: settings.model,
      }),
    [root, scope, settings.provider, settings.model]
  );

  const probes = useMemo(() => steps.map((step) => requestFor(step.nodeId)), [steps, requestFor]);
  const { marks, checking } = useCachedMarks(root === "" ? null : root, probes);

  const send = useCallback(
    async (nodeId: string) => {
      setState((current) => ({ ...current, [nodeId]: { status: "running" } }));
      try {
        const answer: AiSummary = await aiSummary(requestFor(nodeId));
        const prose = parseTourStop(answer.text, known);
        setState((current) => ({
          ...current,
          [nodeId]: prose
            ? { status: "ready", prose, cached: answer.cached }
            : { status: "error", message: "the answer was not in the shape a step needs" },
        }));
      } catch (reason: unknown) {
        setState((current) => ({
          ...current,
          [nodeId]: { status: "error", message: String(reason) },
        }));
      }
    },
    [known, requestFor]
  );

  const explain = useCallback(
    async (step: TourStep) => {
      // A stored answer is read from this machine, so only a request that would
      // reach the provider asks first — the rule the AI panel already follows.
      if (!marks[requestSignature(requestFor(step.nodeId))] && !isConfirmed(root)) {
        setPending(step.nodeId);
        return;
      }
      await send(step.nodeId);
    },
    [marks, requestFor, root, send]
  );

  const confirm = useCallback(async () => {
    if (pending === null) {
      return;
    }
    rememberConfirmed(root);
    const nodeId = pending;
    setPending(null);
    await send(nodeId);
  }, [pending, root, send]);

  return {
    state,
    cached: (nodeId: string) => Boolean(marks[requestSignature(requestFor(nodeId))]),
    checking,
    // `ready` is the panel's shorthand for "a key is held", so asking it here as well
    // made this false whenever it mattered. The key that counts is this provider's.
    needsKey: !settings.hasKey,
    providerLabel:
      PROVIDERS.find((entry) => entry.id === settings.provider)?.label ?? settings.provider,
    pending,
    explain,
    confirm,
    cancel: useCallback(() => setPending(null), []),
  };
}
