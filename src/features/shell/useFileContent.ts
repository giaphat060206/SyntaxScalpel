import { useCallback } from "react";
import type { ParseResult } from "../../shared/types";
import { routeForExtension } from "../../shared/extensions";
import { parseJsTs, parsePython, parseRust, readMarkdown } from "../../shared/ipc";
import { useAsyncLoad } from "./useAsyncLoad";

export type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "graph"; result: ParseResult }
  | { status: "markdown"; content: string };

type FileContent =
  | { status: "graph"; result: ParseResult }
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
    switch (route) {
      case "python":
        return { status: "graph", result: await parsePython(filePath, root) };
      case "jsts":
        return { status: "graph", result: await parseJsTs(filePath, root) };
      case "rust":
        return { status: "graph", result: await parseRust(filePath, root) };
      case "markdown":
        return { status: "markdown", content: await readMarkdown(filePath, root) };
      default:
        throw new Error("Unsupported file type");
    }
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
