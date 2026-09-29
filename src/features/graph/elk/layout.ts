import type { Edge, Node } from "@xyflow/react";
import ELK from "elkjs/lib/elk-api";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";
import { buildElkGraph } from "./graph";
import { applyElkResult, type ElkLayoutResult } from "./result";

const MAX_NODES = 1500;

type LayoutFn = (graph: unknown) => Promise<unknown>;

let elk: InstanceType<typeof ELK> | null = null;
let override: LayoutFn | null = null;

function getLayoutFn(): LayoutFn {
  if (override) {
    return override;
  }
  if (!elk) {
    try {
      elk = new ELK({ workerUrl });
    } catch {
      // Worker unavailable (older WebView, CSP): fall back to the main thread.
      elk = new ELK();
    }
  }
  return (graph) => elk!.layout(graph as never);
}

/** Test seam: replace the ELK call (pass null to restore the real one). */
export function __setElkLayoutForTests(layoutFn: LayoutFn | null): void {
  override = layoutFn;
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
    const result = await getLayoutFn()(graph);
    return applyElkResult(nodes, result as never);
  } catch {
    return null;
  }
}
