export { formatCallNames, formatCost, formatSeconds, formatTokens } from "../core/format";

let traceRef = "<trace>";

/** Set once when --run scopes the process, so printed hints stay copy-pasteable. */
export function setTraceRef(ref: string): void {
  traceRef = ref;
}

/** How printed hints refer to the trace argument, e.g. "<trace> --run 2". */
export function getTraceRef(): string {
  return traceRef;
}

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
 * Pass sourceLength when `text` was reformatted (e.g. whitespace-collapsed)
 * so the remainder count matches what `get` actually returns.
 */
export function truncate(
  text: string,
  pointer?: string,
  max = MAX_FIELD_CHARS,
  sourceLength = text.length,
): string {
  if (text.length <= max) return text;
  const rest = Math.max(sourceLength - max, 1);
  const hint = pointer ? ` - run: unbox-ai get ${traceRef} '${pointer}'` : "";
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
