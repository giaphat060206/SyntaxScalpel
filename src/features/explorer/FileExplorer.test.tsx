import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SearchProvider } from "../shell/SearchContext";
import { FileExplorer } from "./FileExplorer";

vi.mock("../../shared/ipc", () => ({
  listDirectory: vi.fn(async () => [
    {
      name: "src",
      path: "src",
      isDir: true,
      children: [{ name: "a.ts", path: "src/a.ts", isDir: false, children: [] }],
    },
  ]),
}));

afterEach(cleanup);

function renderExplorer(overrides: { selectedFile?: string | null } = {}) {
  const onSelectFile = vi.fn();
  const onSelectFolder = vi.fn();
  const onFocusFolder = vi.fn();
  render(
    <SearchProvider>
      <FileExplorer
        root="/project"
        selectedFile={overrides.selectedFile ?? null}
        onSelectFile={onSelectFile}
        onSelectFolder={onSelectFolder}
        onFocusFolder={onFocusFolder}
      />
    </SearchProvider>
  );
  return { onSelectFile, onSelectFolder, onFocusFolder };
}

describe("FileExplorer", () => {
  it("focuses a folder on single click and opens it on double click", async () => {
    const { onSelectFolder, onFocusFolder } = renderExplorer();
    const folder = await screen.findByText("src");

    fireEvent.click(folder);
    expect(onFocusFolder).toHaveBeenCalledWith("src");
    expect(onSelectFolder).not.toHaveBeenCalled();

    fireEvent.doubleClick(folder);
    expect(onSelectFolder).toHaveBeenCalledWith("src");
  });

  it("reveals the current selection by expanding its ancestors", async () => {
    renderExplorer({ selectedFile: "src/a.ts" });
    await screen.findByText("src");
    await waitFor(() => expect(screen.getByText("a.ts")).toBeTruthy());
  });
});
