import type { Message } from "../../core/types";
import { fail, type LoadedTrace } from "../load";
import { formatCost, formatSeconds, formatTokens, printJson, truncate } from "../output";

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
  console.log(
    gen.carriedMessages > 0
      ? `context: ${gen.carriedMessages} carried messages + ${gen.newMessages.length} new`
      : `context: fresh conversation, ${gen.newMessages.length} messages`,
  );
  console.log("");
  gen.newMessages.forEach((message) => printMessage(message, gen.index));
}

function printMessage(message: Message, genIndex: number): void {
  const pointer = `events[${genIndex}].messages[${message.index}].content`;
  console.log(`--- [${message.index}] ${message.role} (~${formatTokens(message.estTokens)} tok)`);
  if (message.text) console.log(truncate(message.text, pointer));
  for (const call of message.toolCalls ?? []) {
    console.log(`  tool_call ${call.name}(${truncate(JSON.stringify(call.args), undefined, 400)})`);
    if (call.result !== undefined) {
      console.log(`  result: ${truncate(call.result, undefined, 400)}`);
    }
  }
  console.log("");
}
