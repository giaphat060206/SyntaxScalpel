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
      parameters: [
        {
          name: "x-request-id",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "dryRun",
          in: "query",
          required: false,
          schema: { type: "boolean" },
        },
      ],
      requestBody: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          status: { type: "string", enum: ["available", "pending", "sold"] },
          tags: { type: "array", items: { type: "string" } },
          owner: { oneOf: [{ type: "string" }, { type: "integer" }] },
          meta: { nullable: true, properties: { created: { type: "string" } } },
          category: { ref: "Category" },
        },
      },
      responses: [
        {
          status: "201",
          schema: { type: "object", properties: { id: { type: "integer" } } },
        },
        {
          status: "400",
          schema: {
            anyOf: [
              { type: "string" },
              { type: "object", properties: { message: { type: "string" } } },
            ],
          },
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

const handlerInventory: ApiInventory = {
  sources: [{ kind: "next-app-router", file: "app/api/pets/route.ts" }],
  warnings: [],
  endpoints: [
    {
      method: "GET",
      path: "/api/pets",
      tags: ["pets"],
      summary: "List pets",
      parameters: [],
      responses: [{ status: "200" }],
      handler: "GET",
      file: "app/api/pets/route.ts",
      line: 3,
      sourceKind: "next-app-router",
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

  it("renders the request-body schema as a tree with properties and required markers", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    expect(screen.getByText("name").parentElement?.textContent).toContain("*");
    expect(screen.getByText("status")).toBeTruthy();
    expect(screen.getByText("tags")).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
  });

  it("renders enum values, array items, refs, and oneOf/anyOf alternatives", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    expect(screen.getByText(/available, pending, sold/)).toBeTruthy();
    expect(screen.getByText("items")).toBeTruthy();
    expect(screen.getByText("one of")).toBeTruthy();
    expect(screen.getByText("any of")).toBeTruthy();
    expect(screen.getByText("Category")).toBeTruthy();
  });

  it("renders nullable schemas", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    expect(screen.getByText(/object \| null/)).toBeTruthy();
  });

  it("renders parameters as a table with location and required flag", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("In")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByText("x-request-id")).toBeTruthy();
    expect(screen.getByText("header")).toBeTruthy();
    expect(screen.getByText("dryRun")).toBeTruthy();
    expect(screen.getByText("yes")).toBeTruthy();
    expect(screen.getByText("no")).toBeTruthy();
  });

  it("keys responses by status code with their schemas", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Create pet"));
    expect(screen.getByText("201")).toBeTruthy();
    expect(screen.getByText("400")).toBeTruthy();
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

  it("filters the list by path, method, or summary and shows an empty message", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    const filter = screen.getByPlaceholderText(/filter/i);
    fireEvent.change(filter, { target: { value: "health" } });
    expect(screen.queryByText("List pets")).toBeNull();
    expect(screen.getAllByText("Health check").length).toBeGreaterThan(0);

    fireEvent.change(filter, { target: { value: "POST" } });
    expect(screen.queryByText("Health check")).toBeNull();
    expect(screen.getAllByText("Create pet").length).toBeGreaterThan(0);

    fireEvent.change(filter, { target: { value: "/health" } });
    expect(screen.getAllByText("Health check").length).toBeGreaterThan(0);
    expect(screen.queryByText("Create pet")).toBeNull();

    fireEvent.change(filter, { target: { value: "nope" } });
    expect(screen.getByText(/No endpoints match/)).toBeTruthy();
  });

  it("lists the contributing API sources", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("openapi")).toBeTruthy();
    expect(screen.getByText("openapi.yaml")).toBeTruthy();
  });

  it("shows warnings from sources that failed to parse while listing the rest", () => {
    const warned: ApiInventory = {
      ...inventory,
      sources: [
        { kind: "openapi", file: "openapi.yaml" },
        { kind: "next-app-router", file: "app/api/users/route.ts" },
      ],
      warnings: ["broken.yaml: could not parse OpenAPI document"],
    };
    render(
      <EndpointsView root="my-project" inventory={warned} onOpenHandler={vi.fn()} />
    );
    expect(screen.getByText("Warnings")).toBeTruthy();
    expect(screen.getByText(/could not parse OpenAPI document/)).toBeTruthy();
    expect(screen.getByText("app/api/users/route.ts")).toBeTruthy();
    expect(screen.getAllByText("/pets").length).toBeGreaterThanOrEqual(2);
  });

  it("calls onOpenHandler with the endpoint file and handler when Open handler is clicked", () => {
    const onOpenHandler = vi.fn();
    render(
      <EndpointsView
        root="my-project"
        inventory={handlerInventory}
        onOpenHandler={onOpenHandler}
      />
    );
    fireEvent.click(screen.getByText("Open handler"));
    expect(onOpenHandler).toHaveBeenCalledWith("app/api/pets/route.ts", "GET");
  });

  it("hides the Open handler action for endpoints without a handler", () => {
    render(
      <EndpointsView root="my-project" inventory={inventory} onOpenHandler={vi.fn()} />
    );
    expect(screen.queryByText("Open handler")).toBeNull();
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
