import { resolvePath } from "../../core/path";
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
