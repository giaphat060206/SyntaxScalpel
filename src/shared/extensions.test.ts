import { describe, it, expect } from "vitest";
import { isCodeRoute, routeForExtension } from "./extensions";

describe("routeForExtension", () => {
  it("routes python files", () => {
    expect(routeForExtension("main.py")).toBe("python");
  });

  it("routes js and ts variants", () => {
    expect(routeForExtension("a.js")).toBe("jsts");
    expect(routeForExtension("a.jsx")).toBe("jsts");
    expect(routeForExtension("a.ts")).toBe("jsts");
    expect(routeForExtension("a.tsx")).toBe("jsts");
  });

  it("routes rust files", () => {
    expect(routeForExtension("lib.rs")).toBe("rust");
    expect(routeForExtension("src/parser/mod.rs")).toBe("rust");
  });

  it("routes markdown", () => {
    expect(routeForExtension("README.md")).toBe("markdown");
  });

  it("is case insensitive and handles multi-dot names", () => {
    expect(routeForExtension("Main.PY")).toBe("python");
    expect(routeForExtension("main.RS")).toBe("rust");
    expect(routeForExtension("notes.v2.md")).toBe("markdown");
  });

  it("returns unsupported for unknown or extensionless names", () => {
    expect(routeForExtension("Makefile")).toBe("unsupported");
    expect(routeForExtension("style.css")).toBe("unsupported");
  });
});

describe("isCodeRoute", () => {
  it("accepts every parsed language", () => {
    expect(isCodeRoute("python")).toBe(true);
    expect(isCodeRoute("jsts")).toBe(true);
    expect(isCodeRoute("rust")).toBe(true);
  });

  it("rejects docs and unsupported files", () => {
    expect(isCodeRoute("markdown")).toBe(false);
    expect(isCodeRoute("unsupported")).toBe(false);
  });
});
