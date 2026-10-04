const KEY = "scalpel.aiConfirmedRoots";

function canonical(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A Digest of the selected code is sent to a Provider, so the first Task run for
 * a project says so and asks. It is remembered per project, because a notice
 * shown on every run is noise and one shown once is a disclosure.
 */
export function isConfirmed(root: string | null): boolean {
  return root !== null && root !== "" && read().includes(canonical(root));
}

export function rememberConfirmed(root: string): void {
  try {
    const next = [...new Set([...read(), canonical(root)])];
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the notice simply appears again next time.
  }
}
