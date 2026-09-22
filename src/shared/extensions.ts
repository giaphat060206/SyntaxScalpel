export type FileRoute = "python" | "jsts" | "markdown" | "unsupported";

export function routeForExtension(name: string): FileRoute {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "unsupported";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "py") return "python";
  if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") return "jsts";
  if (ext === "md") return "markdown";
  return "unsupported";
}
