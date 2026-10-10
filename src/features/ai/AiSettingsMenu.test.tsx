import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  aiSettings: vi.fn(),
  setAiKey: vi.fn(),
  clearAiKey: vi.fn(),
}));

vi.mock("../../shared/ipc", () => ({
  aiSettings: mocks.aiSettings,
  setAiKey: mocks.setAiKey,
  clearAiKey: mocks.clearAiKey,
  // The model suggestions are a hint; an empty catalogue is a valid answer.
  aiModels: () => Promise.resolve([]),
}));

import { AiSettingsMenu } from "./AiSettingsMenu";
import { useAiSettings } from "./useAiSettings";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  mocks.aiSettings.mockReset().mockResolvedValue({ hasKey: false });
  mocks.setAiKey.mockReset().mockResolvedValue({ hasKey: true });
  mocks.clearAiKey.mockReset().mockResolvedValue({ hasKey: false });
});

function open() {
  render(<AiSettingsMenu />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

describe("AiSettingsMenu", () => {
  it("changes the provider for the whole app, not just this menu", async () => {
    // The tour reads these settings from the shell, so the proof that matters is
    // that a second consumer sees the change at all.
    const elsewhere = renderHook(() => useAiSettings());
    open();

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "deepseek" } });

    await waitFor(() => expect(elsewhere.result.current.provider).toBe("deepseek"));
    expect(window.localStorage.getItem("scalpel.aiProvider")).toBe("deepseek");
  });

  it("saves the key, then never shows it again", async () => {
    open();
    const field = screen.getByLabelText("API key") as HTMLInputElement;
    // Saving announces, so the hook asks Rust again — and the two answers have to
    // agree, or the test is describing a state the app cannot reach.
    mocks.aiSettings.mockResolvedValue({ hasKey: true });

    fireEvent.change(field, { target: { value: "sk-test" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(mocks.setAiKey).toHaveBeenCalledWith("openrouter", "sk-test");
    // Rust reports only whether a key exists, so there is nothing to render back.
    expect(field.value).toBe("");
    await waitFor(() => expect(screen.getByText(/is in the OS keyring/)).toBeTruthy());
  });

  it("names the provider whose key is missing", () => {
    open();

    expect(screen.getByText(/No OpenRouter key yet/)).toBeTruthy();
  });

  it("closes on Escape", () => {
    open();
    expect(screen.getByLabelText("Provider")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByLabelText("Provider")).toBeNull();
  });
});
