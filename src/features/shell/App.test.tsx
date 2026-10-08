import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
  projectProps: vi.fn(),
  projectGraph: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));

vi.mock("../../shared/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared/ipc")>()),
  projectGraph: mocks.projectGraph,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
  usePanelRef: () => ({ current: null }),
}));

vi.mock("../project/ProjectGraph", () => ({
  ProjectGraph: (props: { onSelect?: (id: string | null) => void }) => {
    mocks.projectProps(props);
    return <div />;
  },
}));

vi.mock("../explorer/FileExplorer", () => ({
  FileExplorer: () => <div />,
}));

vi.mock("./ContentPane", () => ({
  ContentPane: (props: {
    root: string | null;
    filePath: string | null;
    initialSelectedId?: string | null;
    onSelect?: (id: string | null) => void;
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
  mocks.projectProps.mockReset();
  mocks.projectGraph.mockReset();
});

function projectPayload(root: string) {
  return { root, folders: [], files: [], edges: [], truncated: false };
}

// Every test that opens a folder now triggers the one project scan, so it needs
// an answer even when that test is about something else entirely.
beforeEach(() => {
  mocks.projectGraph.mockResolvedValue(projectPayload("proj"));
});

describe("App project scan", () => {
  it("lands on the dashboard, and shows the graph without scanning again", async () => {
    mocks.openDialog.mockResolvedValue("proj");
    render(<App />);

    fireEvent.click(screen.getByText("Open Folder…"));

    // The project opens at its dashboard, not at the canvas.
    expect(await screen.findByRole("heading", { name: "proj" })).toBeTruthy();
    expect(mocks.projectGraph).toHaveBeenCalledWith("proj", "");
    expect(mocks.projectGraph).toHaveBeenCalledTimes(1);
    expect(mocks.projectProps).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    await waitFor(() => expect(mocks.projectProps).toHaveBeenCalledTimes(1));

    // The canvas is given the scan rather than performing one itself.
    const calls = mocks.projectProps.mock.calls;
    const project = calls[calls.length - 1]?.[0];
    expect(project.state).toMatchObject({ status: "ready" });

    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(await screen.findByRole("heading", { name: "proj" })).toBeTruthy();

    // Two views of one folder, one walk of the project.
    expect(mocks.projectGraph).toHaveBeenCalledTimes(1);
  });
});

describe("App wiring for the graph selections", () => {
  it("gives both canvases a way to report what is selected", async () => {
    mocks.openDialog.mockResolvedValue("proj");
    render(<App />);

    fireEvent.click(screen.getByText("Open Folder…"));

    // A project opens on its dashboard now, so reach the canvas from the top bar.
    fireEvent.click(await screen.findByRole("button", { name: "Graph" }));

    await waitFor(() => expect(mocks.projectProps).toHaveBeenCalled());
    const projectCalls = mocks.projectProps.mock.calls;
    const project = projectCalls[projectCalls.length - 1]?.[0];
    expect(project.onSelect).toEqual(expect.any(Function));
  });
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
      onSelect: expect.any(Function),
    });
  });
});
