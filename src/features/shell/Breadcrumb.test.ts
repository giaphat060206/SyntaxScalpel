import { describe, it, expect } from "vitest";
import { breadcrumbs } from "./Breadcrumb";

describe("breadcrumbs", () => {
  it("builds cumulative paths for a folder path", () => {
    const crumbs = breadcrumbs("a/b", "folder");
    expect(crumbs.map((crumb) => crumb.path)).toEqual(["a", "a/b"]);
  });

  it("marks the code file crumb as not navigable and ancestors as navigable", () => {
    const crumbs = breadcrumbs("a/b/c.py", "code");
    const file = crumbs.find((crumb) => crumb.label === "c.py")!;
    expect(file.navigable).toBe(false);
    const first = crumbs.find((crumb) => crumb.label === "a")!;
    expect(first.navigable).toBe(true);
  });
});
