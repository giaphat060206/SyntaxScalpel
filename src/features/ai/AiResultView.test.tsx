import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportSummary } from "../../shared/ipc";
import { AiResultView, exportName } from "./AiResultView";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

vi.mock("../../shared/ipc", () => ({ exportSummary: vi.fn() }));

const answer = {
  key: "a".repeat(64),
  text: "## What it does\n\nIt returns a path.",
  task: "explain-selection",
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  cached: false,
  truncated: false,
  createdAtMs: Date.now(),
  inputTokens: 10,
  outputTokens: 5,
};

function renderView(overrides: { root?: string | null } = {}) {
  const onRegenerate = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <AiResultView
      root={overrides.root === undefined ? "/project" : overrides.root}
      result={answer}
      onRegenerate={onRegenerate}
      onClose={onClose}
    />
  );
  return { onRegenerate, onClose };
}

beforeEach(() => {
  vi.mocked(save).mockResolvedValue("C:\\Users\\me\\Documents\\summary.md");
  vi.mocked(exportSummary).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiResultView", () => {
  it("renders the answer and who it came from", () => {
    renderView();

    expect(screen.getByText(/It returns a path/)).toBeTruthy();
    expect(screen.getByText(/openrouter · deepseek\/deepseek-chat/)).toBeTruthy();
  });

  it("regenerates through the callback", async () => {
    const { onRegenerate } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(onRegenerate).toHaveBeenCalled());
  });

  it("dismisses through the callback", () => {
    const { onClose } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe("exporting a summary", () => {
  it("offers a readable Markdown filename and writes to the chosen path", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() =>
      expect(vi.mocked(exportSummary)).toHaveBeenCalledWith(
        "/project",
        answer.key,
        "C:\\Users\\me\\Documents\\summary.md"
      )
    );
    expect(vi.mocked(save)).toHaveBeenCalledWith({
      defaultPath: "explain-selection-deepseek-deepseek-chat.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    await screen.findByText(/Exported to summary.md/);
  });

  it("writes nothing when the save dialog is dismissed", async () => {
    vi.mocked(save).mockResolvedValue(null);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(vi.mocked(save)).toHaveBeenCalled());
    expect(vi.mocked(exportSummary)).not.toHaveBeenCalled();
    expect(screen.queryByText(/Exported to/)).toBeNull();
  });

  it("shows why an export failed, including one that is no longer cached", async () => {
    vi.mocked(exportSummary).mockRejectedValue(
      new Error("that summary is no longer cached: regenerate it first")
    );
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await screen.findByText(/no longer cached/);
  });

  it("cannot export without a project root", () => {
    renderView({ root: null });

    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("exportName", () => {
  it("keeps the task and flattens the model into a legal filename", () => {
    expect(exportName(answer)).toBe("explain-selection-deepseek-deepseek-chat.md");
    expect(exportName({ ...answer, model: "anthropic/claude:3.5" })).toBe(
      "explain-selection-anthropic-claude-3.5.md"
    );
  });
});
