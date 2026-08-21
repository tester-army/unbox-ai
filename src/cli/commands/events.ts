import { toolCallNames } from "../../core/normalize";
import type { LoadedTrace } from "../load";
import { formatCost, formatSeconds, formatTokens, printJson, table } from "../output";

/** Prints one table row per generation. */
export function events(loaded: LoadedTrace, json: boolean): void {
  const gens = loaded.trace.generations;
  if (json) {
    printJson(
      gens.map((gen) => ({
        index: gen.index,
        segment: gen.segment,
        model: gen.model,
        ...gen.metrics,
        toolCount: gen.toolCount,
        newMessages: gen.newMessages.length,
        toolCalls: toolCallNames(gen),
      })),
    );
    return;
  }
  const rows = gens.map((gen) => [
    String(gen.index),
    String(gen.segment),
    formatTokens(gen.metrics.inputTokens),
    formatTokens(gen.metrics.outputTokens),
    formatSeconds(gen.metrics.latency),
    formatCost(gen.metrics.cost),
    toolCallNames(gen).join(",") || "-",
  ]);
  console.log(table(["idx", "seg", "in", "out", "latency", "cost", "tool calls"], rows));
}
