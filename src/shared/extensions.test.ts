import { describe, it, expect } from "vitest";
import { routeForExtension } from "./extensions";

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

  it("routes markdown", () => {
    expect(routeForExtension("README.md")).toBe("markdown");
  });

  it("is case insensitive and handles multi-dot names", () => {
    expect(routeForExtension("Main.PY")).toBe("python");
    expect(routeForExtension("notes.v2.md")).toBe("markdown");
  });

  it("returns unsupported for unknown or extensionless names", () => {
    expect(routeForExtension("Makefile")).toBe("unsupported");
    expect(routeForExtension("style.css")).toBe("unsupported");
  });
});
