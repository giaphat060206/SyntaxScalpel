export type FileRoute = "python" | "jsts" | "rust" | "markdown" | "unsupported";

const CODE_ROUTES: FileRoute[] = ["python", "jsts", "rust"];

export function routeForExtension(name: string): FileRoute {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "unsupported";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "py") return "python";
  if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") return "jsts";
  if (ext === "rs") return "rust";
  if (ext === "md") return "markdown";
  return "unsupported";
}

/** True for routes the backend parses into a Function Graph. */
export function isCodeRoute(route: FileRoute): boolean {
  return CODE_ROUTES.includes(route);
}
