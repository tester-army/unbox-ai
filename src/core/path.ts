/**
 * Resolves a dot/bracket pointer like "events[3].messages[2].content" against
 * a raw trace - the same pointer syntax `unbox-ai get` accepts and truncation
 * hints print.
 */
export function resolvePath(root: unknown, path: string): unknown {
  const segments = path.match(/[^.[\]]+/g) ?? [];
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
