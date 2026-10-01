import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncLoad } from "./useAsyncLoad";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe("useAsyncLoad", () => {
  it("is idle when the key is null", () => {
    const { result } = renderHook(() => useAsyncLoad(null, null));
    expect(result.current.status).toBe("idle");
  });

  it("goes loading then ready", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncLoad("k", () => d.promise));
    expect(result.current.status).toBe("loading");
    await act(async () => d.resolve("hi"));
    expect(result.current).toEqual({ status: "ready", value: "hi" });
  });

  it("captures the error message", async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncLoad("k", () => d.promise));
    await act(async () => d.reject(new Error("nope")));
    expect(result.current).toEqual({ status: "error", message: "Error: nope" });
  });

  it("drops a stale resolve after the key changes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useAsyncLoad(key, () => (key === "one" ? first.promise : second.promise)),
      { initialProps: { key: "one" } }
    );
    rerender({ key: "two" });
    await act(async () => first.resolve("old"));
    expect(result.current.status).toBe("loading");
    await act(async () => second.resolve("new"));
    expect(result.current).toEqual({ status: "ready", value: "new" });
  });
});
