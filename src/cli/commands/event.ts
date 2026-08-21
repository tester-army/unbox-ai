import { formatMs } from "../../core/format";
import type { Message } from "../../core/types";
import { fail, type LoadedTrace } from "../load";
import {
  argsPointer,
  contentPointer,
  formatCost,
  formatSeconds,
  formatTokens,
  printJson,
  truncate,
} from "../output";

const TOOL_FIELD_CHARS = 400;

/** Prints one generation: metrics, token breakdown, and new-vs-previous messages. */
export function event(loaded: LoadedTrace, index: number, json: boolean): void {
  const gen = loaded.trace.generations[index];
  if (!gen) fail(`No generation ${index} (trace has ${loaded.trace.generations.length})`);
  if (json) {
    printJson(gen);
    return;
  }
  const m = gen.metrics;
  console.log(
    `generation ${gen.index}  seg ${gen.segment}  ${gen.model}  ` +
      `${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out  ` +
      `${formatSeconds(m.latency)} (ttft ${formatSeconds(m.timeToFirstToken)})  ${formatCost(m.cost)}`,
  );
  const byGroup = gen.breakdown.groups
    .map((g) => `${g.key} ~${formatTokens(g.estTokens)}`)
    .join(", ");
  console.log(`input split (est): ${byGroup}  |  ${gen.toolCount} tools available`);
  const folded =
    gen.foldedResults > 0
      ? ` (${gen.foldedResults} tool result${gen.foldedResults === 1 ? "" : "s"} shown under calls)`
      : "";
  console.log(
    gen.carriedMessages > 0
      ? `context: ${gen.carriedMessages} carried messages + ${gen.newMessages.length} new${folded}`
      : `context: fresh conversation, ${gen.newMessages.length} messages${folded}`,
  );
  console.log("");
  gen.newMessages.forEach((message) => printMessage(message, gen.index));
}

function printMessage(message: Message, genIndex: number): void {
  console.log(`--- [${message.index}] ${message.role} (~${formatTokens(message.approxTokens)} tok)`);
  if (message.text) console.log(truncate(message.text, contentPointer(genIndex, message.index)));
  message.toolCalls?.forEach((call, callIndex) => {
    console.log(
      `  tool_call ${call.name}(${truncate(
        JSON.stringify(call.args),
        argsPointer(genIndex, message.index, callIndex),
        TOOL_FIELD_CHARS,
      )})`,
    );
    if (call.result !== undefined) {
      const pointer = call.resultRef
        ? contentPointer(call.resultRef.event, call.resultRef.message)
        : undefined;
      const meta = [
        call.durationMs !== undefined ? formatMs(call.durationMs) : undefined,
        call.success === false ? "FAILED" : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      const label = meta ? `result (${meta})` : "result";
      console.log(`  ${label}: ${truncate(call.result, pointer, TOOL_FIELD_CHARS)}`);
    }
  });
  console.log("");
}
