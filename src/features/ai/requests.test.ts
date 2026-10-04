import { describe, it, expect } from "vitest";
import type { AiRequest } from "../../shared/ipc";
import { requestKey, requestSignature, sameRequest } from "./requests";

const base: AiRequest = {
  root: "/project",
  target: { kind: "scope", scope: "core" },
  task: "project-overview",
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
};

describe("requestKey", () => {
  it("keys a task by its id", () => {
    expect(requestKey(base)).toBe("project-overview");
  });

  it("keys a connection by its pair, so both ends agree", () => {
    const request: AiRequest = {
      ...base,
      target: { kind: "connection", source: "a.py::one", target: "b.py::two" },
      task: "relationship",
    };

    expect(requestKey(request)).toBe("relationship:a.py::one->b.py::two");
  });
});

describe("requestSignature", () => {
  it("separates the same task on different targets", () => {
    const other: AiRequest = { ...base, target: { kind: "scope", scope: "utils" } };

    expect(requestSignature(base)).not.toBe(requestSignature(other));
  });

  it("separates the same request asked of another model", () => {
    expect(requestSignature(base)).not.toBe(
      requestSignature({ ...base, model: "deepseek-reasoner" })
    );
    expect(requestSignature(base)).not.toBe(
      requestSignature({ ...base, provider: "deepseek" })
    );
  });

  it("is stable for the same question", () => {
    expect(requestSignature({ ...base })).toBe(requestSignature(base));
  });
});

describe("sameRequest", () => {
  it("accepts the same question and rejects a different model", () => {
    expect(sameRequest(base, { ...base })).toBe(true);
    expect(sameRequest(base, { ...base, model: "other" })).toBe(false);
    expect(sameRequest(base, { ...base, root: "/elsewhere" })).toBe(false);
  });
});
