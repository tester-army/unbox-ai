export { formatCompact, formatCost, formatSeconds, formatTokens } from "../core/format";

/** Canonical `get` pointer to a message's content. */
export function contentPointer(genIndex: number, messageIndex: number): string {
  return `events[${genIndex}].messages[${messageIndex}].content`;
}

/** Canonical `get` pointer to a tool call's arguments. */
export function argsPointer(genIndex: number, messageIndex: number, callIndex: number): string {
  return `events[${genIndex}].messages[${messageIndex}].tool_calls[${callIndex}].function.arguments`;
}

/** Hard cap on any single text field printed to stdout, so agent context stays bounded. */
const MAX_FIELD_CHARS = 1500;

/**
 * Truncates long text, appending the exact `get` pointer to fetch the rest.
 */
export function truncate(text: string, pointer?: string, max = MAX_FIELD_CHARS): string {
  if (text.length <= max) return text;
  const rest = text.length - max;
  const hint = pointer ? ` - run: unbox-ai get <trace> '${pointer}'` : "";
  return `${text.slice(0, max)}\n[... ${rest} more chars${hint}]`;
}

/** Renders rows as a padded plain-text table. */
export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => (row[col] ?? "").length)));
  const line = (row: string[]) =>
    row.map((cell, col) => (cell ?? "").padEnd(widths[col] ?? 0)).join("  ");
  return [line(headers), ...rows.map(line)].join("\n");
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
