import { useCallback } from "react";
import type { FunctionGraph } from "../../shared/types";
import { isCodeRoute, routeForExtension } from "../../shared/extensions";
import { functionGraph, readMarkdown } from "../../shared/ipc";
import { useAsyncLoad } from "./useAsyncLoad";

export type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "graph"; graph: FunctionGraph }
  | { status: "markdown"; content: string };

type FileContent =
  | { status: "graph"; graph: FunctionGraph }
  | { status: "markdown"; content: string };

export function useFileContent(
  root: string | null,
  filePath: string | null
): FileState {
  const route = filePath ? routeForExtension(filePath) : "unsupported";
  const supported = Boolean(root && filePath && route !== "unsupported");

  const load = useCallback(async (): Promise<FileContent> => {
    if (!root || !filePath) {
      throw new Error("Unsupported file type");
    }
    if (route === "markdown") {
      return { status: "markdown", content: await readMarkdown(filePath, root) };
    }
    if (isCodeRoute(route)) {
      // One command covers every parsed language, and brings the cross-file
      // neighbourhood and the Import Analysis with it.
      return { status: "graph", graph: await functionGraph(filePath, root) };
    }
    throw new Error("Unsupported file type");
  }, [root, filePath, route]);

  const state = useAsyncLoad<FileContent>(
    supported ? `${root}|${filePath}` : null,
    supported ? load : null
  );

  if (!supported && root && filePath) {
    return { status: "error", message: "Unsupported file type" };
  }
  if (state.status === "ready") {
    return state.value;
  }
  return state;
}
