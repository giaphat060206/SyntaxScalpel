import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ContentPane } from "./ContentPane";

const graphProps = vi.fn();

vi.mock("../graph/GraphView", () => ({
  GraphView: (props: { selectedId: string | null }) => {
    graphProps(props.selectedId);
    return <div />;
  },
}));

vi.mock("./useFileContent", () => ({
  useFileContent: () => ({
    status: "graph",
    result: {
      filePath: "api/route.ts",
      edges: [],
      nodes: [
        {
          id: "GET",
          kind: "function",
          name: "GET",
          params: [],
          returns: [],
        },
      ],
    },
  }),
}));

vi.mock("./useImports", () => ({ useImports: () => null }));
vi.mock("./useSource", () => ({ useSource: () => null }));

afterEach(() => {
  cleanup();
  graphProps.mockReset();
});

describe("ContentPane initial selection", () => {
  it("selects the definition named by initialSelectedId", () => {
    render(
      <ContentPane root="proj" filePath="api/route.ts" initialSelectedId="GET" />
    );
    expect(graphProps).toHaveBeenCalledWith("GET");
  });

  it("has no selection when initialSelectedId is absent", () => {
    render(<ContentPane root="proj" filePath="api/route.ts" />);
    expect(graphProps).toHaveBeenCalledWith(null);
  });
});
