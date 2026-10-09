import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  aiSettings: vi.fn(),
  setAiKey: vi.fn(),
  clearAiKey: vi.fn(),
}));

vi.mock("../../shared/ipc", () => ({
  aiSettings: mocks.aiSettings,
  setAiKey: mocks.setAiKey,
  clearAiKey: mocks.clearAiKey,
}));

import { useAiSettings } from "./useAiSettings";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  mocks.aiSettings.mockReset().mockResolvedValue({ hasKey: false });
  mocks.setAiKey.mockReset();
  mocks.clearAiKey.mockReset();
});

describe("useAiSettings", () => {
  it("defaults to the first provider and its own stored choice", () => {
    const { result } = renderHook(() => useAiSettings());
    expect(result.current.provider).toBe("openrouter");

    window.localStorage.setItem("scalpel.aiProvider", "deepseek");
    const second = renderHook(() => useAiSettings());
    expect(second.result.current.provider).toBe("deepseek");
  });

  it("tells every other surface when the provider changes", async () => {
    // The tour reads these settings from the shell, which never unmounts: without a
    // shared store it would keep sending to whichever provider was chosen at start.
    const tour = renderHook(() => useAiSettings());
    const panel = renderHook(() => useAiSettings());
    expect(tour.result.current.provider).toBe("openrouter");

    act(() => panel.result.current.setProvider("deepseek"));

    await waitFor(() => expect(tour.result.current.provider).toBe("deepseek"));
  });

  it("follows a provider change with the key that belongs to it", async () => {
    mocks.aiSettings.mockImplementation((provider: string) =>
      Promise.resolve({ hasKey: provider === "deepseek" })
    );
    const tour = renderHook(() => useAiSettings());
    const panel = renderHook(() => useAiSettings());
    await waitFor(() => expect(tour.result.current.hasKey).toBe(false));

    act(() => panel.result.current.setProvider("deepseek"));

    // The keyring entry is per provider, so the new provider has to be asked about.
    await waitFor(() => expect(tour.result.current.hasKey).toBe(true));
  });

  it("tells every other surface when a key is saved for the current provider", async () => {
    const tour = renderHook(() => useAiSettings());
    const panel = renderHook(() => useAiSettings());
    mocks.setAiKey.mockResolvedValue({ hasKey: true });
    mocks.aiSettings.mockResolvedValue({ hasKey: true });

    await act(async () => {
      await panel.result.current.saveKey("sk-test");
    });

    await waitFor(() => expect(tour.result.current.hasKey).toBe(true));
  });
});
