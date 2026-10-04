import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import App from "./App";

const mocks = vi.hoisted(() => ({
  openDialog: vi.fn(),
  contentProps: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
  usePanelRef: () => ({ current: null }),
}));

vi.mock("../project/ProjectGraph", () => ({
  ProjectGraph: () => <div />,
}));

vi.mock("../explorer/FileExplorer", () => ({
  FileExplorer: () => <div />,
}));

vi.mock("./ContentPane", () => ({
  ContentPane: (props: {
    root: string | null;
    filePath: string | null;
    initialSelectedId?: string | null;
  }) => {
    mocks.contentProps(props);
    return <div />;
  },
}));

vi.mock("../endpoints/EndpointsPane", () => ({
  EndpointsPane: ({
    onOpenHandler,
  }: {
    root: string;
    onOpenHandler: (file: string, handler: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onOpenHandler("app/api/pets/route.ts", "GET")}
    >
      open-handler-stub
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.openDialog.mockReset();
  mocks.contentProps.mockReset();
});

describe("App open-handler navigation", () => {
  it("navigates to the handler file's Code Location with the handler selected", async () => {
    mocks.openDialog.mockResolvedValue("proj");
    render(<App />);

    fireEvent.click(screen.getByText("Open Folder…"));
    await screen.findByText("API");

    fireEvent.click(screen.getByText("API"));
    fireEvent.click(await screen.findByText("open-handler-stub"));

    await waitFor(() => {
      expect(mocks.contentProps).toHaveBeenCalled();
    });
    const calls = mocks.contentProps.mock.calls;
    const last = calls[calls.length - 1]?.[0];
    expect(last).toMatchObject({
      filePath: "app/api/pets/route.ts",
      initialSelectedId: "GET",
    });
  });
});
