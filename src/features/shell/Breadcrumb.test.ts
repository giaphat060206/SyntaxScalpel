import { describe, it, expect } from "vitest";
import { breadcrumbs } from "./Breadcrumb";

function isLink(crumbs: ReturnType<typeof breadcrumbs>, index: number): boolean {
  return crumbs[index].navigable && index < crumbs.length - 1;
}

describe("breadcrumbs", () => {
  it("builds cumulative paths for a folder path", () => {
    const crumbs = breadcrumbs("a/b", "folder");
    expect(crumbs.map((crumb) => crumb.path)).toEqual(["a", "a/b"]);
    expect(crumbs[0].navigable).toBe(true);
    expect(isLink(crumbs, 0)).toBe(true);
    expect(isLink(crumbs, 1)).toBe(false);
  });

  it("keeps the parent folder of a code file navigable", () => {
    const crumbs = breadcrumbs("a/b/c.py", "code");
    expect([crumbs[0].navigable, crumbs[1].navigable]).toEqual([true, true]);
    expect(isLink(crumbs, 0)).toBe(true);
    expect(isLink(crumbs, 1)).toBe(true);
    expect(isLink(crumbs, 2)).toBe(false);
  });
});
