import { describe, it, expect } from "vitest";
import type { ProjectFile, ProjectGraph } from "../../shared/types";
import { formatBytes, summariseProject } from "./summary";

function file(
  id: string,
  kind: "code" | "doc",
  sizeBytes: number,
  external = false
): ProjectFile {
  return {
    id,
    name: id.split("/").pop() ?? id,
    folderId: "",
    kind,
    sizeBytes,
    imports: [],
    external,
  };
}

function project(
  files: ProjectFile[],
  overrides: Partial<ProjectGraph> = {}
): ProjectGraph {
  return { root: "/project", folders: [], files, edges: [], truncated: false, ...overrides };
}

describe("summariseProject", () => {
  it("adds up files, bytes and the code/doc split", () => {
    const summary = summariseProject(
      project([file("a.py", "code", 100), file("b.py", "code", 300), file("r.md", "doc", 50)])
    );

    expect(summary.files).toBe(3);
    expect(summary.bytes).toBe(450);
    expect(summary.codeFiles).toBe(2);
    expect(summary.docFiles).toBe(1);
  });

  it("groups by language and sorts by bytes", () => {
    const summary = summariseProject(
      project([
        file("main.py", "code", 1000),
        file("util.py", "code", 100),
        file("app.ts", "code", 400),
        file("notes.txt", "doc", 5),
      ])
    );

    expect(summary.languages.map((entry) => [entry.language, entry.files, entry.bytes])).toEqual([
      ["Python", 2, 1100],
      ["TypeScript", 1, 400],
      ["Text", 1, 5],
    ]);
  });

  it("measures a share by bytes, and the shares add up to the whole", () => {
    const summary = summariseProject(
      project([file("a.py", "code", 750), file("b.ts", "code", 250)])
    );
    const share = Object.fromEntries(
      summary.languages.map((entry) => [entry.language, entry.share])
    );

    expect(share.Python).toBeCloseTo(0.75, 10);
    expect(share.TypeScript).toBeCloseTo(0.25, 10);
    expect(summary.languages.reduce((total, entry) => total + entry.share, 0)).toBeCloseTo(1, 10);
  });

  it("keeps external files out of every total but still counts them", () => {
    const summary = summariseProject(
      project([file("main.py", "code", 100), file("lib/vendored.py", "code", 9999, true)])
    );

    expect(summary.files).toBe(1);
    expect(summary.bytes).toBe(100);
    expect(summary.externalFiles).toBe(1);
    expect(summary.languages).toEqual([
      { language: "Python", files: 1, bytes: 100, share: 1 },
    ]);
    expect(summary.largestFiles.map((entry) => entry.path)).toEqual(["main.py"]);
  });

  it("does not divide by zero on an empty project", () => {
    const summary = summariseProject(project([]));

    expect(summary.files).toBe(0);
    expect(summary.bytes).toBe(0);
    expect(summary.languages).toEqual([]);
    expect(summary.largestFiles).toEqual([]);
  });

  it("reports a zero share, not NaN, when every file is empty", () => {
    const summary = summariseProject(
      project([file("a.py", "code", 0), file("b.ts", "code", 0)])
    );

    expect(summary.files).toBe(2);
    expect(summary.bytes).toBe(0);
    expect(summary.languages.map((entry) => entry.share)).toEqual([0, 0]);
  });

  it("lists the largest files first and stops at ten", () => {
    const files = Array.from({ length: 12 }, (_, index) =>
      file(`f${index}.py`, "code", (index + 1) * 10)
    );
    const summary = summariseProject(project(files));

    expect(summary.largestFiles).toHaveLength(10);
    expect(summary.largestFiles[0]).toEqual({ path: "f11.py", bytes: 120 });
    expect(summary.largestFiles[9].bytes).toBe(30);
  });

  it("passes truncation through, and reads entry points from either shape", () => {
    const truncated = summariseProject(
      project([file("main.py", "code", 1)], {
        truncated: true,
        entries: ["main.py"],
        entry: "main.py",
      })
    );

    expect(truncated.truncated).toBe(true);
    expect(truncated.entryPoints).toEqual(["main.py"]);
    expect(summariseProject(project([], { entry: "app.py" })).entryPoints).toEqual(["app.py"]);
    expect(summariseProject(project([])).entryPoints).toEqual([]);
  });

  it("counts folders and edges", () => {
    const summary = summariseProject(
      project([file("a.py", "code", 1)], {
        folders: [{ id: "", name: "project", depth: 0 }],
        edges: [
          { source: "a.py", target: "b.py" },
          { source: "a.py", target: "c.py" },
        ],
      })
    );

    expect(summary.folders).toBe(1);
    expect(summary.edges).toBe(2);
  });

  it("breaks ties by name, so the order cannot flap between runs", () => {
    const summary = summariseProject(
      project([file("b.py", "code", 10), file("a.ts", "code", 10)])
    );

    expect(summary.languages.map((entry) => entry.language)).toEqual(["Python", "TypeScript"]);
  });
});

describe("formatBytes", () => {
  it("matches what a file manager shows for the same file", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(1024 ** 3 * 2)).toBe("2.0 GB");
  });

  it("never prints NaN or a negative size", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});
