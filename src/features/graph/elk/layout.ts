import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk-api";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";
import { buildElkGraph, type ElkGraph } from "./graph";
import { applyElkResult, type ElkLayoutResult, type ElkResultLike } from "./result";

const MAX_NODES = 1500;
const LAYOUT_TIMEOUT_MS = 15000;

interface ElkLike {
  layout(graph: ElkGraph): Promise<ElkResultLike>;
}

type ElkFactory = () => ElkLike;
type LayoutFn = (graph: ElkGraph) => Promise<ElkResultLike>;

let elk: ElkLike | null = null;
let override: LayoutFn | null = null;
let factoryOverride: ElkFactory | null = null;

async function createElk(): Promise<ElkLike> {
  if (factoryOverride) {
    return factoryOverride();
  }
  try {
    return new ELK({ workerUrl }) as unknown as ElkLike;
  } catch {
    // The api build cannot run without a worker; use the main-thread build.
    const { default: MainThreadELK } = await import("elkjs/lib/elk.bundled.js");
    return new MainThreadELK() as unknown as ElkLike;
  }
}

async function getLayoutFn(): Promise<LayoutFn> {
  if (override) {
    return override;
  }
  if (!elk) {
    elk = await createElk();
  }
  const instance = elk;
  return (graph) => instance.layout(graph);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("elk layout timed out")), ms);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Test seam: replace the ELK call (null restores the real one). */
export function __setElkLayoutForTests(layoutFn: LayoutFn | null): void {
  override = layoutFn;
}

/** Test seam: replace the ELK instance factory (null restores the real one). */
export function __setElkFactoryForTests(factory: ElkFactory | null): void {
  factoryOverride = factory;
  elk = null;
}

export async function runElkLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<ElkLayoutResult | null> {
  if (nodes.filter((node) => !node.hidden).length > MAX_NODES) {
    return null;
  }
  try {
    const graph = buildElkGraph(nodes, edges);
    const layoutFn = await getLayoutFn();
    const result = await withTimeout(layoutFn(graph), LAYOUT_TIMEOUT_MS);
    return applyElkResult(nodes, result);
  } catch (error) {
    // Silent failure hid a stalling worker behind a 15s wait, so say so.
    console.warn("elk layout failed; falling back to the grid", error);
    return null;
  }
}
