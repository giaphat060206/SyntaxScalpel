import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SchemaTree } from "./SchemaTree";

afterEach(cleanup);

describe("SchemaTree", () => {
  it("keeps a primitive field's name and type on the same line", () => {
    const { container } = render(
      <SchemaTree
        schema={{
          type: "object",
          properties: { avatar: { type: "string", nullable: true } },
        }}
      />
    );
    const leaf = container.querySelector("li")?.lastElementChild as HTMLElement;
    expect(leaf.textContent).toBe("string | null");
    expect(leaf.className).not.toContain("block");
  });

  it("nests object properties under the field", () => {
    const { container } = render(
      <SchemaTree
        schema={{
          type: "object",
          properties: {
            sender: { type: "object", properties: { id: { type: "string" } } },
          },
        }}
      />
    );
    const sender = container.querySelector("li") as HTMLElement;
    expect(sender.querySelector("ul")).not.toBeNull();
    expect(sender.textContent).toContain("sender");
    expect(sender.textContent).toContain("id");
  });
});
