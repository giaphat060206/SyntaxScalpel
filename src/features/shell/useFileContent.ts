import { useEffect, useState } from "react";
import type { ParseResult } from "../../shared/types";
import { routeForExtension } from "../../shared/extensions";
import { parseJsTs, parsePython, readMarkdown } from "../../shared/ipc";

export type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "graph"; result: ParseResult }
  | { status: "markdown"; content: string };

export function useFileContent(
  root: string | null,
  filePath: string | null
): FileState {
  const [state, setState] = useState<FileState>({ status: "idle" });

  useEffect(() => {
    if (!root || !filePath) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    const route = routeForExtension(filePath);
    const load = async (): Promise<FileState> => {
      switch (route) {
        case "python":
          return { status: "graph", result: await parsePython(filePath, root) };
        case "jsts":
          return { status: "graph", result: await parseJsTs(filePath, root) };
        case "markdown":
          return { status: "markdown", content: await readMarkdown(filePath, root) };
        default:
          return { status: "error", message: "Unsupported file type" };
      }
    };

    load()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, filePath]);

  return state;
}
