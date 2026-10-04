import type { AiRequest } from "../../shared/ipc";

/**
 * What a stored answer is remembered by. A Task is one answer; a Connection is
 * one answer per pair, so both ends recognise it.
 */
export function requestKey(request: AiRequest): string {
  if (request.target.kind === "connection") {
    return `relationship:${request.target.source}->${request.target.target}`;
  }
  return request.task;
}

/** A stored answer counts only for the same question: same code, same provider,
 *  same model. The Digest is deterministic, so equal requests mean one cache key
 *  — this is a session shortcut, never a source of truth. */
export function sameRequest(stored: AiRequest, wanted: AiRequest): boolean {
  return (
    stored.root === wanted.root &&
    stored.task === wanted.task &&
    stored.provider === wanted.provider &&
    stored.model === wanted.model &&
    JSON.stringify(stored.target) === JSON.stringify(wanted.target)
  );
}
