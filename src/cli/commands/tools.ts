import { formatCompact, formatMs } from "../../core/format";
import { allToolCalls } from "../../core/normalize";
import type { LoadedTrace } from "../load";
import { getTraceRef, printJson, table, truncate } from "../output";

const ARGS_PREVIEW_CHARS = 60;

/**
 * Tool usage summary (one row per tool), or every individual call with
 * --all / --json - the same two views the web ui's tools section has.
 */
export function tools(loaded: LoadedTrace, json: boolean, all: boolean): void {
  const calls = allToolCalls(loaded.trace);
  if (json) {
    printJson(calls);
    return;
  }
  if (calls.length === 0) {
    console.log("no tool calls in this trace");
    return;
  }

  if (all) {
    const rows = calls.map((call) => [
      `[${call.gen}]`,
      call.name,
      status(call.success, call.result !== undefined),
      call.durationMs !== undefined ? formatMs(call.durationMs) : "-",
      call.result !== undefined ? formatCompact(call.result.length) : "-",
      truncate(JSON.stringify(call.args) ?? "", undefined, ARGS_PREVIEW_CHARS).replace(/\n.*/s, "..."),
    ]);
    console.log(table(["gen", "name", "status", "time", "size", "args"], rows));
    console.log(`\ndrill in: unbox-ai event ${getTraceRef()} <gen>`);
    return;
  }

  const byName = new Map<
    string,
    { calls: number; failures: number; totalMs: number | null; totalSize: number }
  >();
  for (const call of calls) {
    const entry = byName.get(call.name) ?? { calls: 0, failures: 0, totalMs: null, totalSize: 0 };
    entry.calls += 1;
    if (call.success === false) entry.failures += 1;
    if (call.durationMs !== undefined) entry.totalMs = (entry.totalMs ?? 0) + call.durationMs;
    entry.totalSize += call.result?.length ?? 0;
    byName.set(call.name, entry);
  }
  const rows = [...byName.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .map(([name, u]) => [
      name,
      String(u.calls),
      u.failures > 0 ? String(u.failures) : "-",
      u.totalMs !== null ? formatMs(u.totalMs) : "-",
      formatCompact(u.totalSize),
    ]);
  console.log(table(["tool", "calls", "failed", "time", "output"], rows));
  console.log(`\n${calls.length} calls across ${byName.size} tools · every call: unbox-ai tools ${getTraceRef()} --all`);
}

function status(success: boolean | undefined, hasResult: boolean): string {
  if (success === false) return "FAILED";
  if (success === true) return "ok";
  return hasResult ? "done" : "-";
}
