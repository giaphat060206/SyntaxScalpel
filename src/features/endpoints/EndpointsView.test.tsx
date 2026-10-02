import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { ApiInventory } from "../../shared/types";
import { EndpointsView } from "./EndpointsView";

const inventory: ApiInventory = {
  sources: [{ kind: "openapi", file: "openapi.yaml" }],
  warnings: [],
  endpoints: [
    {
      method: "GET",
      path: "/pets",
      tags: ["pets"],
      summary: "List pets",
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer" },
        },
      ],
      responses: [
        {
          status: "200",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "integer" } },
            },
          },
        },
      ],
      file: "api/openapi.yaml",
      line: 0,
      sourceKind: "openapi",
      fidelity: "full",
    },
    {
      method: "POST",
      path: "/pets",
      tags: ["pets"],
      summary: "Create pet",
      parameters: [],
      requestBody: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      responses: [
        {
          status: "201",
          schema: { type: "object", properties: { id: { type: "integer" } } },
        },
      ],
      file: "api/openapi.yaml",
      line: 0,
      sourceKind: "openapi",
      fidelity: "full",
    },
    {
      method: "GET",
      path: "/health",
      tags: [],
      summary: "Health check",
      parameters: [],
      responses: [{ status: "200" }],
      file: "api/openapi.yaml",
      line: 0,
      sourceKind: "openapi",
      fidelity: "heuristic",
    },
  ],
};

afterEach(cleanup);

describe("EndpointsView", () => {
  it("groups endpoints by tag and shows method, path, summary, and file", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    expect(screen.getByText("pets")).toBeTruthy();
    expect(screen.getByText("Untagged")).toBeTruthy();
    expect(screen.getAllByText("/pets").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("List pets").length).toBeGreaterThan(0);
    expect(screen.getByText("Health check")).toBeTruthy();
    expect(screen.getAllByText("api/openapi.yaml").length).toBeGreaterThan(0);
  });

  it("shows parameters, responses, schema fields, and fidelity for the selected endpoint", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    expect(screen.getByText("limit")).toBeTruthy();
    expect(screen.getByText("query")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.getByText("id")).toBeTruthy();
    expect(screen.getByText("full")).toBeTruthy();
  });

  it("switches the detail pane when another endpoint is selected", () => {
    const { container } = render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    const text = container.textContent ?? "";
    expect(text).toContain("name");
    expect(text).toContain("string");
    expect(text).toContain("201");
  });

  it("filters the list by method, path, or summary", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.change(screen.getByPlaceholderText(/filter/i), {
      target: { value: "health" },
    });
    expect(screen.queryByText("List pets")).toBeNull();
    expect(screen.getAllByText("Health check").length).toBeGreaterThan(0);
  });

  it("names the searched root when no API sources are found", () => {
    render(
      <EndpointsView
        root="my-project"
        inventory={{ sources: [], endpoints: [], warnings: [] }}
        onOpenHandler={vi.fn()}
      />
    );
    expect(screen.getByText(/No API sources found/)).toBeTruthy();
    expect(screen.getByText(/my-project/)).toBeTruthy();
  });
});
