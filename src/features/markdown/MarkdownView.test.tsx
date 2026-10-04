import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MarkdownView } from "./MarkdownView";

afterEach(cleanup);

/** The AI's answers are Markdown, so what reaches the pane is source with
 *  backticks in it. A reader must never see the markers themselves. */
describe("MarkdownView", () => {
  it("renders an inline code span as code, not as literal backticks", () => {
    const { container } = render(
      <MarkdownView content={"It imports `PathFinder` from `core/path.py`."} />
    );

    const spans = [...container.querySelectorAll("code")].map((node) => node.textContent);

    expect(spans).toEqual(["PathFinder", "core/path.py"]);
    expect(container.textContent).not.toContain("`");
  });

  it("renders a fenced block as a pre without its fences", () => {
    const { container } = render(
      <MarkdownView content={"```python\ndef one():\n    return 1\n```\n"} />
    );

    expect(container.querySelector("pre code")?.textContent).toContain("def one()");
    expect(container.textContent).not.toContain("```");
  });

  it("keeps a heading a heading and a bullet a bullet", () => {
    const { container } = render(
      <MarkdownView content={"# Overview\n\n- one\n- two\n"} />
    );

    expect(container.querySelector("h1")?.textContent).toBe("Overview");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
