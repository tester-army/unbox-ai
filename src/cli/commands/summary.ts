import { type AggregateKey, aggregateBy } from "../../core/aggregate";
import { formatPercent } from "../../core/format";
import { computeInsights } from "../../core/insights";
import { toolCallNames } from "../../core/normalize";
import type { LoadedTrace } from "../load";
import {
  formatCallNames,
  formatCost,
  formatSeconds,
  formatTokens,
  getTraceRef,
  printJson,
  table,
} from "../output";

/** Prints trace totals plus a one-liner per generation. */
export function summary(loaded: LoadedTrace, json: boolean, by?: AggregateKey): void {
  const { trace } = loaded;
  const insights = computeInsights(trace);
  if (json) {
    if (by !== undefined) {
      printJson({ by, rows: aggregateBy(trace, by) });
      return;
    }
    printJson({
      traceId: trace.traceId,
      format: loaded.format,
      name: trace.name,
      timestamp: trace.timestamp,
      models: trace.models,
      generations: trace.generations.length,
      segments: trace.segmentCount,
      totalTokens: trace.totalTokens,
      cacheableTokens: insights.cachedTokens,
      promptWaitShare: insights.promptWaitShare,
      prefixRepaidTokens: insights.prefixRepaid,
      totalCost: trace.totalCost,
      totalLatency: trace.totalLatency,
    });
    return;
  }
  console.log(`${trace.name}  (trace ${trace.traceId})`);
  console.log(`format    ${loaded.format}`);
  console.log(`started   ${trace.timestamp}`);
  console.log(`models    ${trace.models.join(", ")}`);
  console.log(
    `totals    ${trace.generations.length} generations in ${trace.segmentCount} segments, ` +
      `${formatTokens(trace.totalTokens.input)} in / ${formatTokens(trace.totalTokens.output)} out, ` +
      `${formatCost(trace.totalCost)}, ${formatSeconds(trace.totalLatency)} model time`,
  );
  console.log(
    `caching   ${formatPercent(insights.cachedTokens, insights.inputTokens)} of input tokens ` +
      `were cached prefix (reported cache reads when available, else estimated from repeats)`,
  );
  if (insights.promptWaitShare !== null) {
    console.log(
      `latency   ${formatPercent(insights.promptWaitShare, 1)} of model time is prompt wait (ttft)`,
    );
  }
  if (insights.prefixRepaid > 0) {
    console.log(
      `re-paid   ~${formatTokens(insights.prefixRepaid)} tokens re-processed at fresh conversation starts`,
    );
  }
  console.log("");
  if (by !== undefined) {
    const rows = aggregateBy(trace, by).map((row) => [
      row.key,
      ...(by === "segment" ? [row.label ?? ""] : []),
      String(row.generations),
      formatTokens(row.inputTokens),
      formatPercent(row.cachedTokens, row.inputTokens),
      formatTokens(row.outputTokens),
      formatSeconds(row.latency),
      formatCost(row.cost),
      String(row.toolCalls),
    ]);
    console.log(
      table(
        [
          by,
          ...(by === "segment" ? ["agent"] : []),
          "generations",
          "input",
          "cached",
          "output",
          "latency",
          "cost",
          "tool calls",
        ],
        rows,
      ),
    );
    console.log(`\nnext: unbox-ai events ${getTraceRef()} | unbox-ai event ${getTraceRef()} <idx>`);
    return;
  }
  for (const gen of trace.generations) {
    const calls = formatCallNames(toolCallNames(gen));
    const last = gen.newMessages.at(-1);
    const doing = calls ? `-> ${calls}` : last ? `-> ${last.text.slice(0, 60)}` : "";
    console.log(
      `  [${gen.index}] seg ${gen.segment}  ${formatTokens(gen.metrics.inputTokens)} in  ` +
        `${formatSeconds(gen.metrics.latency)}  ${formatCost(gen.metrics.cost)}  ${doing}`,
    );
  }
  console.log(`\nnext: unbox-ai events ${getTraceRef()} | unbox-ai event ${getTraceRef()} <idx>`);
}
