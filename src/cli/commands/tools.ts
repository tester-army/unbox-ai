import { formatCompact, formatMs } from "../../core/format";
import { allToolCalls } from "../../core/normalize";
import type { LoadedTrace } from "../load";
import { printJson, table, truncate } from "../output";

const ARGS_PREVIEW_CHARS = 60;

/** Every tool call in the trace, network-inspector style: status, time, size. */
export function tools(loaded: LoadedTrace, json: boolean): void {
  const calls = allToolCalls(loaded.trace);
  if (json) {
    printJson(calls);
    return;
  }
  if (calls.length === 0) {
    console.log("no tool calls in this trace");
    return;
  }
  const rows = calls.map((call) => [
    `[${call.gen}]`,
    call.name,
    call.success === false ? "FAILED" : call.success === true ? "ok" : call.result !== undefined ? "done" : "-",
    call.durationMs !== undefined ? formatMs(call.durationMs) : "-",
    call.result !== undefined ? formatCompact(call.result.length) : "-",
    truncate(JSON.stringify(call.args) ?? "", undefined, ARGS_PREVIEW_CHARS).replace(/\n.*/s, "..."),
  ]);
  console.log(table(["gen", "name", "status", "time", "size", "args"], rows));
  console.log("\ndrill in: unbox-ai event <trace> <gen>");
}
