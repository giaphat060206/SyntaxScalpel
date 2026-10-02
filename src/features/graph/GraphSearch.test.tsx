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
});
