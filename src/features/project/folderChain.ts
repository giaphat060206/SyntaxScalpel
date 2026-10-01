import type { ProjectFolder } from "../../shared/types";

export function folderChain(
  folderId: string,
  folderById: Map<string, ProjectFolder>
): string[] {
  const chain: string[] = [];
  let current: string | undefined = folderId;
  while (current) {
    chain.push(current);
    current = folderById.get(current)?.parentId;
  }
  return chain;
}
