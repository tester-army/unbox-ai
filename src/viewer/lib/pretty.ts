/**
 * Unwraps the tool runtime's `{"type":...,"value":...}` payload envelope:
 * string values render as plain text with real newlines, object values as
 * indented JSON. Non-JSON text passes through untouched.
 */
export function prettyPayload(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    const value =
      parsed !== null && typeof parsed === "object" && "value" in parsed
        ? (parsed as { value: unknown }).value
        : parsed;
    return renderValue(value);
  } catch {
    return text;
  }
}

const BLOCK_CHARS = 200;

/**
 * Renders a payload value for humans: strings as-is, and flat objects as
 * `key: value` lines with multi-line string fields (diffs, logs) unescaped
 * into labeled blocks instead of staying one giant JSON-escaped line.
 */
function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const scalars: string[] = [];
    const blocks: string[] = [];
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string" && (v.includes("\n") || v.length > BLOCK_CHARS)) {
        blocks.push(`${key}:\n${v}`);
      } else if (typeof v === "string") {
        scalars.push(`${key}: ${v}`);
      } else {
        const compact = JSON.stringify(v);
        if (compact !== undefined && compact.length > BLOCK_CHARS) {
          blocks.push(`${key}:\n${JSON.stringify(v, null, 2)}`);
        } else {
          scalars.push(`${key}: ${compact}`);
        }
      }
    }
    if (blocks.length > 0) return [...scalars, "", ...blocks].join("\n").trim();
    return JSON.stringify(value, null, 2);
  }
  return JSON.stringify(value, null, 2);
}

/** Compact args stay on one line; big ones get indented. */
export function prettyArgs(args: unknown): string {
  if (typeof args === "string") return args;
  const compact = JSON.stringify(args);
  return compact.length > 120 ? JSON.stringify(args, null, 2) : compact;
}
