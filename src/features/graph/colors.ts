export const PALETTE = [
  "#00F0FF", // cyan
  "#3DF0A8", // mint
  "#FFB454", // amber
  "#B78CFF", // violet
  "#FF7AB6", // pink
  "#6EC1FF", // blue
  "#F2E96B", // yellow
  "#7CF2C2", // teal
];

/** Stable per-node colour, so a block and its edges keep the same hue. */
export function colorForNode(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
