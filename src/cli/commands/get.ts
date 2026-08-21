import { fail, type LoadedTrace } from "../load";

/**
 * Prints the exact raw value at a dot/bracket path, e.g.
 * events[3].messages[2].content - the escape hatch truncation points to.
 */
export function get(loaded: LoadedTrace, path: string): void {
  const value = resolvePath(loaded.raw, path);
  if (value === undefined) fail(`Nothing at path: ${path}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function resolvePath(root: unknown, path: string): unknown {
  const segments = path.match(/[^.[\]]+/g) ?? [];
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
