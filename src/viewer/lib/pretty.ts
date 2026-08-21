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
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return text;
  }
}

/** Compact args stay on one line; big ones get indented. */
export function prettyArgs(args: unknown): string {
  if (typeof args === "string") return args;
  const compact = JSON.stringify(args);
  return compact.length > 120 ? JSON.stringify(args, null, 2) : compact;
}
