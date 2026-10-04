import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { SearchProvider } from "../shell/SearchContext";
import { FileExplorer } from "./FileExplorer";

vi.mock("../../shared/ipc", () => ({
  listDirectory: vi.fn(async () => [
    {
      name: "folder1",
      path: "folder1",
      isDir: true,
      children: [
        {
          name: "folder2",
          path: "folder1/folder2",
          isDir: true,
          children: [
            { name: "file2", path: "folder1/folder2/file2", isDir: false, children: [] },
          ],
        },
        {
          name: "folder3",
          path: "folder1/folder3",
          isDir: true,
          children: [
            { name: "file3", path: "folder1/folder3/file3", isDir: false, children: [] },
          ],
        },
      ],
    },
  ]),
}));

afterEach(cleanup);

function renderExplorer(
  overrides: {
    selectedFile?: string | null;
    revealFolder?: { path: string; nonce: number } | null;
  } = {}
) {
  const onSelectFile = vi.fn();
  const onSelectFolder = vi.fn();
  const onFocusFolder = vi.fn();
  const view = render(
    <SearchProvider>
      <FileExplorer
        root="/project"
        selectedFile={overrides.selectedFile ?? null}
        onSelectFile={onSelectFile}
        onSelectFolder={onSelectFolder}
        onFocusFolder={onFocusFolder}
        revealFolder={overrides.revealFolder ?? null}
      />
    </SearchProvider>
  );
  return { onSelectFile, onSelectFolder, onFocusFolder, view };
}

describe("FileExplorer", () => {
  it("focuses a folder on single click and opens it on double click", async () => {
    const { onSelectFolder, onFocusFolder } = renderExplorer();
    const folder = await screen.findByText("folder1");

    fireEvent.click(folder);
    expect(onFocusFolder).toHaveBeenCalledWith("folder1");
    expect(onSelectFolder).not.toHaveBeenCalled();

    fireEvent.doubleClick(folder);
    expect(onSelectFolder).toHaveBeenCalledWith("folder1");
  });

  it("reveals the current selection by expanding its ancestors", async () => {
    renderExplorer({ selectedFile: "folder1/folder2/file2" });
    await screen.findByText("folder1");
    await waitFor(() => expect(screen.getByText("folder2")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("file2")).toBeTruthy());
  });
});

describe("FileExplorer folder reveal", () => {
  it("opens a folder picked elsewhere exactly one level deep", async () => {
    const { view } = renderExplorer();
    await screen.findByText("folder1");
    expect(screen.queryByText("folder2")).toBeNull();

    view.rerender(
      <SearchProvider>
        <FileExplorer
          root="/project"
          selectedFile={null}
          onSelectFile={vi.fn()}
          onSelectFolder={vi.fn()}
          onFocusFolder={vi.fn()}
          revealFolder={{ path: "folder1", nonce: 1 }}
        />
      </SearchProvider>
    );

    // Its children appear...
    await waitFor(() => expect(screen.getByText("folder2")).toBeTruthy());
    expect(screen.getByText("folder3")).toBeTruthy();
    // ...and nothing below them does.
    expect(screen.queryByText("file2")).toBeNull();
    expect(screen.queryByText("file3")).toBeNull();
  });

  it("closes a deeper level when an ancestor is picked again", async () => {
    const { view } = renderExplorer();
    await screen.findByText("folder1");

    view.rerender(
      <SearchProvider>
        <FileExplorer
          root="/project"
          selectedFile={null}
          onSelectFile={vi.fn()}
          onSelectFolder={vi.fn()}
          onFocusFolder={vi.fn()}
          revealFolder={{ path: "folder1", nonce: 1 }}
        />
      </SearchProvider>
    );
    await waitFor(() => expect(screen.getByText("folder2")).toBeTruthy());

    // Open the deeper level by hand, then pick the ancestor again.
    const row = screen.getByText("folder2").closest("div") as HTMLElement;
    fireEvent.click(within(row).getByTitle("Expand folder"));
    await waitFor(() => expect(screen.getByText("file2")).toBeTruthy());

    view.rerender(
      <SearchProvider>
        <FileExplorer
          root="/project"
          selectedFile={null}
          onSelectFile={vi.fn()}
          onSelectFolder={vi.fn()}
          onFocusFolder={vi.fn()}
          revealFolder={{ path: "folder1", nonce: 2 }}
        />
      </SearchProvider>
    );
    await waitFor(() => expect(screen.queryByText("file2")).toBeNull());
    expect(screen.getByText("folder2")).toBeTruthy();
  });
});
