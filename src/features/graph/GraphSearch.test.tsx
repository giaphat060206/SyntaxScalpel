import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { GraphSearch } from "./GraphSearch";

afterEach(cleanup);

describe("GraphSearch", () => {
  it("keeps the query and box open after picking a result", () => {
    const onPick = vi.fn();
    render(<GraphSearch items={[{ id: "a", label: "alpha" }]} onPick={onPick} />);

    fireEvent.click(screen.getByTitle("Search (Ctrl+F)"));
    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "al" } });
    fireEvent.click(screen.getByText("alpha"));

    expect(onPick).toHaveBeenCalledWith("a");
    expect((screen.getByPlaceholderText("Search…") as HTMLInputElement).value).toBe("al");
  });

  it("stays clear of the bottom-right corner the shell's buttons use", () => {
    // "Show docs" sits at bottom-3 right-3 in the same panel; sharing it buried
    // that button under this one.
    const { container } = render(
      <GraphSearch items={[]} onPick={vi.fn()} />
    );
    const button = container.querySelector("button") as HTMLElement;
    expect(button.className).toContain("bottom-12");
    expect(button.className).not.toContain("bottom-3 ");
    expect(button.className).toContain("right-3");

    fireEvent.click(button);
    const box = screen.getByPlaceholderText("Search…").parentElement as HTMLElement;
    expect(box.className).toContain("bottom-12");
  });
});
