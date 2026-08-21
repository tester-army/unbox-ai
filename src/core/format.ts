/** Formats a count compactly: 310334 -> "310.3k". */
export function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Formats a token count compactly: 310334 -> "310.3k". */
export const formatTokens = formatCompact;

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/** Formats a millisecond duration: 845 -> "845ms", 7085 -> "7.09s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return formatSeconds(ms / 1000);
}

/** Collapses repeated tool names: [a,a,a,b] -> "a x3, b". */
export function formatCallNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(", ");
}

/** Share of a whole as a percent string: (41, 100) -> "41%". */
export function formatPercent(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}
