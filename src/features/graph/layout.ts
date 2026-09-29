import type { Node } from "@xyflow/react";
import type { CodeNodeData } from "./CodeNode";

// Auto-layout geometry (pixels). Class containers stack their methods using the
// measured heights, so wrapped params/returns can never overlap the next method.
export const CHILD_X = 20;
export const CHILD_WIDTH = 200;
export const CHILD_GAP = 48;
export const CLASS_HEADER = 76;
export const CLASS_PAD = 12;
export const CLASS_WIDTH = 240;
export const TOP_GAP = 90;
export const TOP_WIDTH = 240;

export const IMPORTS_NODE_ID = "__imports";
export const IMPORTED_BY_NODE_ID = "__imported_by";
export const CONSTANTS_NODE_ID = "__constants";

export function nodeHeight(node: Node): number {
  const styleHeight = (node.style as { height?: number } | undefined)?.height;
  return node.measured?.height ?? node.height ?? styleHeight ?? 96;
}

export function absolutePosition(node: Node, byId: Map<string, Node>): { x: number; y: number } {
  if (node.parentId) {
    const parent = byId.get(node.parentId);
    if (parent) {
      return {
        x: parent.position.x + node.position.x,
        y: parent.position.y + node.position.y,
      };
    }
  }
  return node.position;
}

/**
 * Pick the handles that face the other node so edges leave from the side
 * (right→left) when blocks are side by side, and top/bottom when stacked.
 */
export function pickHandles(
  source: Node,
  target: Node,
  byId: Map<string, Node>
): { sourceHandle?: string; targetHandle?: string } {
  const from = absolutePosition(source, byId);
  const to = absolutePosition(target, byId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { sourceHandle: "r-out", targetHandle: "l-in" }
      : { sourceHandle: "l-out", targetHandle: "r-in" };
  }
  return dy > 0
    ? { sourceHandle: "b-out", targetHandle: "t-in" }
    : { sourceHandle: "t-out", targetHandle: "b-in" };
}

// Preferred handle order per direction: the first entry faces the other node,
// the rest rotate so parallel edges from the same block use different sides
// instead of stacking on one segment.
const OUT_ORDER: Record<string, string[]> = {
  right: ["r-out", "b-out", "t-out", "l-out"],
  left: ["l-out", "b-out", "t-out", "r-out"],
  down: ["b-out", "r-out", "l-out", "t-out"],
  up: ["t-out", "r-out", "l-out", "b-out"],
};
const IN_ORDER: Record<string, string[]> = {
  right: ["l-in", "t-in", "b-in", "r-in"],
  left: ["r-in", "t-in", "b-in", "l-in"],
  down: ["t-in", "l-in", "r-in", "b-in"],
  up: ["b-in", "l-in", "r-in", "t-in"],
};

/**
 * Like `pickHandles`, but rotates through each block's four sides by edge index
 * so many edges into or out of one block do not all overlap on a single path.
 */
export function spreadHandles(
  source: Node,
  target: Node,
  byId: Map<string, Node>,
  sourceIndex: number,
  targetIndex: number
): { sourceHandle: string; targetHandle: string } {
  const from = absolutePosition(source, byId);
  const to = absolutePosition(target, byId);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const direction =
    Math.abs(dx) > Math.abs(dy)
      ? dx >= 0
        ? "right"
        : "left"
      : dy >= 0
        ? "down"
        : "up";
  const outs = OUT_ORDER[direction];
  const ins = IN_ORDER[direction];
  return {
    sourceHandle: outs[sourceIndex % outs.length],
    targetHandle: ins[targetIndex % ins.length],
  };
}

/**
 * Near-square grid positions for a set of nodes: 9 -> 3x3, 10 -> 3 cols x 4
 * rows, 16 -> 4x4. Column widths come from each column's widest block.
 */
export function arrangeGrid(
  items: Node[],
  startX: number,
  startY: number,
  gapX: number,
  gapY: number
): {
  positions: { x: number; y: number }[];
  right: number;
  bottom: number;
} {
  const count = items.length;
  const cols = Math.max(1, Math.floor(Math.sqrt(count)));
  const columnWidths = new Array<number>(cols).fill(0);
  const rowHeights: number[] = [];
  items.forEach((node, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const width =
      (node.style as { width?: number } | undefined)?.width ?? CHILD_WIDTH;
    columnWidths[column] = Math.max(columnWidths[column], width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, nodeHeight(node));
  });

  const columnX: number[] = [];
  let cursorX = startX;
  for (let column = 0; column < cols; column++) {
    columnX[column] = cursorX;
    cursorX += columnWidths[column] + gapX;
  }
  const rowY: number[] = [];
  let cursorY = startY;
  for (let row = 0; row < rowHeights.length; row++) {
    rowY[row] = cursorY;
    cursorY += rowHeights[row] + gapY;
  }

  return {
    positions: items.map((_, index) => ({
      x: columnX[index % cols],
      y: rowY[Math.floor(index / cols)],
    })),
    right: cursorX - gapX,
    bottom: cursorY - gapY,
  };
}

/**
 * Stack a class node's methods by their real heights and give the class the
 * matching height, then stack top-level nodes that the user has not pinned.
 * Converges: returns the same array reference when nothing needs to change.
 */
export function reflowLayout(current: Node[]): Node[] {
  const next = current.map((node) => ({ ...node }));
  const childrenByParent = new Map<string, Node[]>();
  for (const node of next) {
    // Hidden nodes (e.g. inside a collapsed folder) are laid out nowhere, so a
    // collapsed container shrinks instead of keeping the space.
    if (!node.parentId || node.hidden) continue;
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }
  let changed = false;

  for (const parent of next) {
    const children = childrenByParent.get(parent.id);
    if (!children || children.length === 0) continue;
    children.sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
    );

    const compact = parent.id === CONSTANTS_NODE_ID;
    const header = compact ? 80 : CLASS_HEADER;
    const gapX = compact ? 22 : CHILD_GAP;
    const gapY = compact ? 22 : CHILD_GAP;

    const grid = arrangeGrid(children, CHILD_X, header, gapX, gapY);
    children.forEach((child, index) => {
      const desired = grid.positions[index];
      if (child.position.x !== desired.x || child.position.y !== desired.y) {
        child.position = desired;
        changed = true;
      }
    });

    const width = Math.max(CLASS_WIDTH, grid.right + CHILD_X);
    const height = grid.bottom + CLASS_PAD;
    const style = (parent.style ?? {}) as { width?: number; height?: number };
    if (style.height !== height || style.width !== width) {
      parent.style = { ...style, width, height };
      changed = true;
    }
  }

  const topLevel = next
    .filter(
      (node) =>
        !node.parentId &&
        !node.hidden &&
        node.id !== IMPORTS_NODE_ID &&
        node.id !== IMPORTED_BY_NODE_ID
    )
    .sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
    );

  // Keep the import blocks anchored along the top edge; everything else starts
  // below them so they never drift or get overlapped.
  let anchorX = 0;
  let topOffset = 0;
  for (const special of next) {
    if (special.id !== IMPORTS_NODE_ID && special.id !== IMPORTED_BY_NODE_ID) {
      continue;
    }
    if (special.position.x !== anchorX || special.position.y !== 0) {
      special.position = { x: anchorX, y: 0 };
      changed = true;
    }
    const width =
      (special.style as { width?: number } | undefined)?.width ?? TOP_WIDTH;
    anchorX += width + TOP_GAP;
    topOffset = Math.max(topOffset, nodeHeight(special));
  }
  topOffset += TOP_GAP;

  const anyPinned = topLevel.some(
    (node) => (node.data as CodeNodeData).pinned === true
  );
  if (anyPinned) {
    let cursor = topOffset;
    for (const node of topLevel) {
      const pinned = (node.data as CodeNodeData).pinned === true;
      const desiredY = pinned ? Math.max(node.position.y, topOffset) : cursor;
      if (!pinned && (node.position.x !== 0 || node.position.y !== desiredY)) {
        node.position = { x: 0, y: desiredY };
        changed = true;
      }
      cursor = Math.max(cursor, desiredY) + nodeHeight(node) + TOP_GAP;
    }
  } else {
    const grid = arrangeGrid(topLevel, 0, topOffset, TOP_GAP, TOP_GAP);
    topLevel.forEach((node, index) => {
      const desired = grid.positions[index];
      if (node.position.x !== desired.x || node.position.y !== desired.y) {
        node.position = desired;
        changed = true;
      }
    });
  }

  return changed ? next : current;
}
