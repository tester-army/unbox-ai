export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** DP-table cells above which diffing is skipped (~64MB of Int32 rows). */
const MAX_CELLS = 16_000_000;

/**
 * Classic LCS line diff: removed lines come from `a`, added from `b`.
 * Returns undefined for pathologically large inputs instead of stalling.
 */
export function diffLines(a: string[], b: string[]): DiffLine[] | undefined {
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return undefined;
  const width = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) lines.push({ kind: "removed", text: a[i]! });
  for (; j < b.length; j++) lines.push({ kind: "added", text: b[j]! });
  return lines;
}
