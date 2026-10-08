import { describe, it, expect } from "vitest";
import { languageForName } from "./languages";

describe("languageForName", () => {
  it("names every extension the parser recognises", () => {
    expect(languageForName("main.py")).toBe("Python");
    expect(languageForName("app.tsx")).toBe("TypeScript");
    expect(languageForName("index.jsx")).toBe("JavaScript");
    expect(languageForName("lib.rs")).toBe("Rust");
    expect(languageForName("README.md")).toBe("Markdown");
    expect(languageForName("config.yaml")).toBe("YAML");
    expect(languageForName("style.scss")).toBe("CSS");
    expect(languageForName("settings.toml")).toBe("TOML");
    expect(languageForName("schema.sql")).toBe("SQL");
  });

  it("ignores case, because the filesystem does not always", () => {
    expect(languageForName("MAIN.PY")).toBe("Python");
    expect(languageForName("App.TSX")).toBe("TypeScript");
  });

  it("puts anything else in Other rather than losing it", () => {
    expect(languageForName("data.tar.gz")).toBe("Other");
    expect(languageForName("Dockerfile")).toBe("Other");
    expect(languageForName(".gitignore")).toBe("Other");
  });
});
