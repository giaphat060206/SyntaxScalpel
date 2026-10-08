import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TopBar } from "./TopBar";

// The vitest config sets no `globals`, so Testing Library's automatic cleanup
// never registers and a previous test's top bar would still be in the document.
afterEach(cleanup);

const handlers = () => ({
  onOpenFolder: vi.fn(),
  onOpenFile: vi.fn(),
  onOpenRecent: vi.fn(),
  onCloseFolder: vi.fn(),
  onOpenDashboard: vi.fn(),
  onOpenGraph: vi.fn(),
  onOpenEndpoints: vi.fn(),
  onOpenAi: vi.fn(),
});

function bar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const spies = handlers();
  render(<TopBar hasFolder recents={[]} {...spies} {...overrides} />);
  return spies;
}

describe("TopBar", () => {
  it("offers the project views only once a project is open", () => {
    bar({ hasFolder: false });

    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Graph" })).toBeNull();
    expect(screen.queryByRole("button", { name: "API" })).toBeNull();
  });

  it("switches to the graph and back from its own buttons", () => {
    const spies = bar({ view: "dashboard" });

    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(spies.onOpenGraph).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(spies.onOpenDashboard).toHaveBeenCalledTimes(1);
  });

  it("marks the view that is showing, and only that one", () => {
    bar({ view: "graph" });

    expect(screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("marks neither view while a file or the endpoint list is on screen", () => {
    bar({ view: null });

    expect(
      screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Dashboard" }).getAttribute("aria-pressed")
    ).toBe("false");
  });
});
