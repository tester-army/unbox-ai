import { formatPercent } from "../../core/format";
import { toolCallNames } from "../../core/normalize";
import type { LoadedTrace } from "../load";
import { formatCost, formatSeconds, formatTokens, printJson } from "../output";

function cacheableSum(loaded: LoadedTrace): number {
  return loaded.trace.generations.reduce((acc, g) => acc + g.breakdown.cacheableTokens, 0);
}

/** Prints trace totals plus a one-liner per generation. */
export function summary(loaded: LoadedTrace, json: boolean): void {
  const { trace } = loaded;
  if (json) {
    printJson({
      traceId: trace.traceId,
      name: trace.name,
      timestamp: trace.timestamp,
      models: trace.models,
      generations: trace.generations.length,
      segments: trace.segmentCount,
      totalTokens: trace.totalTokens,
      cacheableTokens: cacheableSum(loaded),
      totalCost: trace.totalCost,
      totalLatency: trace.totalLatency,
    });
    return;
  }
  console.log(`${trace.name}  (trace ${trace.traceId})`);
  console.log(`started   ${trace.timestamp}`);
  console.log(`models    ${trace.models.join(", ")}`);
  console.log(
    `totals    ${trace.generations.length} generations in ${trace.segmentCount} segments, ` +
      `${formatTokens(trace.totalTokens.input)} in / ${formatTokens(trace.totalTokens.output)} out, ` +
      `${formatCost(trace.totalCost)}, ${formatSeconds(trace.totalLatency)} model time`,
  );
  console.log(
    `caching   ${formatPercent(cacheableSum(loaded), trace.totalTokens.input)} of input tokens ` +
      `were a repeated prefix within a segment (cache-eligible)`,
  );
  console.log("");
  for (const gen of trace.generations) {
    const calls = toolCallNames(gen).join(", ");
    const last = gen.newMessages.at(-1);
    const doing = calls ? `-> ${calls}` : last ? `-> ${last.text.slice(0, 60)}` : "";
    console.log(
      `  [${gen.index}] seg ${gen.segment}  ${formatTokens(gen.metrics.inputTokens)} in  ` +
        `${formatSeconds(gen.metrics.latency)}  ${formatCost(gen.metrics.cost)}  ${doing}`,
    );
  }
  console.log("\nnext: unbox-ai events <trace> | unbox-ai event <trace> <idx>");
}
