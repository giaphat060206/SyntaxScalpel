import type { AiRequest } from "../../shared/ipc";

/** The Task id Rust knows this as. The JSON contract it asks for lives in
 *  `ai/prompts.rs`; this parser is the other half, so the two change together. */
export const TOUR_STOP_TASK = "tour-stop";

export interface TourProse {
  /** A few words naming this part, from the model. Never the step's identity. */
  title: string;
  /** Markdown, rendered like any other answer. */
  why: string;
  /** Ids it named that are really in the payload, so a step can point at them. */
  lookAt: string[];
  /** Ids it named that are not, counted rather than shown. */
  dropped: number;
}

interface RequestInput {
  root: string;
  scope: string;
  nodeId: string;
  provider: string;
  model: string;
}

/**
 * One stop, asked for as one file. The Digest layers a task pays for are decided in
 * Rust, so this says nothing about them.
 */
export function tourStopRequest(input: RequestInput): AiRequest {
  return {
    root: input.root,
    target: { kind: "files", scope: input.scope, files: [input.nodeId] },
    task: TOUR_STOP_TASK,
    provider: input.provider,
    model: input.model,
  };
}

/** A model may fence its JSON or say a sentence first; the object is what matters. */
function unwrap(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * The model's answer, or null when it is not usable. Ids are checked against the
 * payload: one that is not in it is dropped and counted, because a step that points
 * at a file which does not exist is worse than a step that points nowhere.
 */
export function parseTourStop(text: string, knownIds: Set<string>): TourProse | null {
  let raw: unknown;
  try {
    raw = JSON.parse(unwrap(text));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const shape = raw as { title?: unknown; why?: unknown; lookAt?: unknown };
  const title = typeof shape.title === "string" ? shape.title.trim() : "";
  const why = typeof shape.why === "string" ? shape.why.trim() : "";
  if (title === "" && why === "") {
    return null;
  }

  const named = Array.isArray(shape.lookAt)
    ? shape.lookAt.filter((id): id is string => typeof id === "string")
    : [];
  const lookAt = named.filter((id) => knownIds.has(id));

  return { title, why, lookAt, dropped: named.length - lookAt.length };
}

/** Every id a step may legitimately point at: the nodes the payload really has. */
export function knownNodeIds(graph: {
  root: string;
  folders: Array<{ id: string }>;
  files: Array<{ id: string }>;
}): Set<string> {
  return new Set([
    graph.root,
    ...graph.folders.map((folder) => folder.id),
    ...graph.files.map((file) => file.id),
  ]);
}
