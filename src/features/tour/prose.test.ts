import { describe, it, expect } from "vitest";
import { knownNodeIds, parseTourStop, tourStopRequest } from "./prose";

const known = new Set([".", "src", "main.py", "src/parser.py"]);

describe("tourStopRequest", () => {
  it("asks about the one file a step points at", () => {
    const request = tourStopRequest({
      root: "/home/me/pathfinder",
      scope: "",
      nodeId: "main.py",
      provider: "openrouter",
      model: "some/model",
    });

    expect(request.task).toBe("tour-stop");
    expect(request.target).toEqual({ kind: "files", scope: "", files: ["main.py"] });
    expect(request).not.toHaveProperty("force");
  });
});

describe("parseTourStop", () => {
  it("reads the shape the prompt asks for", () => {
    const prose = parseTourStop(
      '{"title":"Entry point","why":"Starts the program and wires the pieces.","lookAt":["src/parser.py"]}',
      known
    );

    expect(prose).toEqual({
      title: "Entry point",
      why: "Starts the program and wires the pieces.",
      lookAt: ["src/parser.py"],
      dropped: 0,
    });
  });

  it("drops an id that is not in the payload, and says how many it dropped", () => {
    const prose = parseTourStop(
      '{"title":"T","why":"W","lookAt":["main.py","src/ghost.py","not/real.ts"]}',
      known
    );

    // A step that points at a file which does not exist is worse than one that
    // points nowhere, so the fabricated ids never reach the panel.
    expect(prose?.lookAt).toEqual(["main.py"]);
    expect(prose?.dropped).toBe(2);
  });

  it("reads JSON a model wrapped in a fence or in a sentence", () => {
    const fenced = parseTourStop(
      '```json\n{"title":"T","why":"W","lookAt":[]}\n```',
      known
    );
    const chatty = parseTourStop(
      'Sure, here it is:\n{"title":"T","why":"W","lookAt":[]}\nHope that helps.',
      known
    );

    expect(fenced?.title).toBe("T");
    expect(chatty?.title).toBe("T");
  });

  it("accepts a missing field as long as there is something to show", () => {
    expect(parseTourStop('{"why":"Only prose."}', known)).toMatchObject({
      title: "",
      why: "Only prose.",
      lookAt: [],
      dropped: 0,
    });
    expect(parseTourStop('{"title":"Only a name"}', known)).toMatchObject({ title: "Only a name" });
  });

  it("ignores a lookAt that is not a list of strings", () => {
    expect(parseTourStop('{"title":"T","why":"W","lookAt":"main.py"}', known)?.lookAt).toEqual([]);
    expect(parseTourStop('{"title":"T","why":"W","lookAt":[1,null,"main.py"]}', known)?.lookAt).toEqual([
      "main.py",
    ]);
  });

  it("returns nothing when the answer is not usable at all", () => {
    expect(parseTourStop("I could not read that file.", known)).toBeNull();
    expect(parseTourStop('{"title":"","why":""}', known)).toBeNull();
    expect(parseTourStop("[1,2,3]", known)).toBeNull();
    expect(parseTourStop("", known)).toBeNull();
  });
});

describe("knownNodeIds", () => {
  it("knows the folders and files the payload really has", () => {
    const ids = knownNodeIds({
      root: "src",
      folders: [{ id: "src" }, { id: "src/parser" }],
      files: [{ id: "src/main.py" }],
    });

    expect([...ids].sort()).toEqual(["src", "src/main.py", "src/parser"]);
  });
});
