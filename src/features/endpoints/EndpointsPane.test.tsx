import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ApiInventory } from "../../shared/types";
import { analyzeApi } from "../../shared/ipc";
import { EndpointsPane } from "./EndpointsPane";

vi.mock("../../shared/ipc", () => ({ analyzeApi: vi.fn() }));

const inventory: ApiInventory = {
  sources: [{ kind: "openapi", file: "openapi.yaml" }],
  warnings: [],
  endpoints: [
    {
      method: "GET",
      path: "/pets",
      tags: ["pets"],
      summary: "List pets",
      parameters: [],
      responses: [],
      file: "openapi.yaml",
      line: 0,
      sourceKind: "openapi",
      fidelity: "full",
    },
  ],
};

beforeEach(() => {
  vi.mocked(analyzeApi).mockReset().mockResolvedValue(inventory);
});

afterEach(cleanup);

describe("EndpointsPane", () => {
  it("scans nothing until asked, and says that asking is slow", () => {
    render(<EndpointsPane root="/project" onOpenHandler={() => {}} />);

    expect(screen.getByText(/reads every file in the project/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate API inventory" })).toBeTruthy();
    expect(vi.mocked(analyzeApi)).not.toHaveBeenCalled();
  });

  it("scans the project once asked, then shows what it found", async () => {
    render(<EndpointsPane root="/project" onOpenHandler={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate API inventory" }));

    expect((await screen.findAllByText("/pets")).length).toBeGreaterThan(0);
    expect(vi.mocked(analyzeApi)).toHaveBeenCalledWith("/project");
  });

  it("says the scan is running rather than looking frozen", async () => {
    let finish: (value: ApiInventory) => void = () => {};
    vi.mocked(analyzeApi).mockImplementation(
      () =>
        new Promise<ApiInventory>((resolve) => {
          finish = resolve;
        })
    );

    render(<EndpointsPane root="/project" onOpenHandler={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate API inventory" }));

    expect(await screen.findByText("Analysing the API…")).toBeTruthy();

    finish(inventory);
    await waitFor(() => expect(screen.queryByText("Analysing the API…")).toBeNull());
  });
});
