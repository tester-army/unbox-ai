import { toolCallNames } from "./normalize";
import type { NormalizedTrace } from "./types";

export type AggregateKey = "model" | "agent" | "segment";

export interface AggregateRow {
  key: string;
  label?: string;
  generations: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  latency: number;
  cost: number;
  toolCalls: number;
}

export function aggregateBy(trace: NormalizedTrace, key: AggregateKey): AggregateRow[] {
  const rows = new Map<string, AggregateRow>();
  for (const generation of trace.generations) {
    const rowKey =
      key === "model"
        ? generation.model
        : key === "agent"
          ? generation.name
          : String(generation.segment);
    const row = rows.get(rowKey) ?? {
      key: rowKey,
      ...(key === "segment" ? { label: generation.name } : {}),
      generations: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      latency: 0,
      cost: 0,
      toolCalls: 0,
    };
    row.generations += 1;
    row.inputTokens += generation.metrics.inputTokens;
    row.cachedTokens += generation.breakdown.cacheableTokens;
    row.outputTokens += generation.metrics.outputTokens;
    row.latency += generation.metrics.latency;
    row.cost += generation.metrics.cost;
    row.toolCalls += toolCallNames(generation).length;
    rows.set(rowKey, row);
  }

  return [...rows.values()].sort((a, b) => {
    if (key === "segment") return Number(a.key) - Number(b.key);
    if (b.cost !== a.cost) return b.cost - a.cost;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
