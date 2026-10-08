/**
 * Where the right-hand pane is pointed. It lives in one place because the top
 * bar, the breadcrumb and the routes all have to agree on it.
 */
export type Location =
  | { kind: "empty" }
  | { kind: "dashboard"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "code"; path: string; select?: string }
  | { kind: "endpoints" };

/**
 * The folder the project views describe: a dashboard and a graph each have one,
 * and a file or the endpoint list falls back to the whole project. Null means no
 * project, which is what stops a scan before one is open.
 */
export function folderScope(location: Location): string | null {
  if (location.kind === "dashboard" || location.kind === "folder") {
    return location.path;
  }
  return location.kind === "empty" ? null : "";
}

/** Whether a path is on screen, so panels that follow one can switch off. A
 *  predicate rather than a plain boolean, so the path is narrowed at the call. */
export function hasPath(
  location: Location
): location is Extract<Location, { path: string }> {
  return (
    location.kind === "dashboard" || location.kind === "folder" || location.kind === "code"
  );
}

/** Which project view is showing, for the top bar's buttons. */
export function projectView(location: Location): "dashboard" | "graph" | null {
  if (location.kind === "dashboard") {
    return "dashboard";
  }
  return location.kind === "folder" ? "graph" : null;
}
