import { resolveAdapter } from "./adapters";
import { normalizeTrace } from "./normalize";
import type { NormalizedTrace, RawTrace } from "./types";

export interface TraceCollectionItem {
  raw: RawTrace;
  trace: NormalizedTrace;
}

export interface TraceCollection {
  /** Which adapter recognized the source, e.g. "ai-sdk-devtools". */
  format: string;
  items: TraceCollectionItem[];
}

/** What the run list shows per trace; served at /api/traces. */
export interface RunSummary {
  id: string;
  name: string;
  timestamp: string;
  generations: number;
  totalTokens: { input: number; output: number };
  models: string[];
  inProgress?: boolean;
  /** Nesting level under the spawning run; 0 for roots. */
  depth: number;
}

/**
 * Parses a source JSON into one trace per independent run. Formats without
 * a split() are a single-item collection.
 */
export function parseCollection(json: unknown): TraceCollection {
  const adapter = resolveAdapter(json);
  const parts = adapter.split?.(json) ?? [json];
  return {
    format: adapter.name,
    items: parts.map((part) => {
      const raw = adapter.adapt(part);
      return { raw, trace: normalizeTrace(raw) };
    }),
  };
}

export function runSummaries(items: TraceCollectionItem[]): RunSummary[] {
  const parents = new Map(items.map(({ trace }) => [trace.traceId, trace.parentTraceId]));
  return items.map(({ trace }) => ({
    id: trace.traceId,
    name: trace.name,
    timestamp: trace.timestamp,
    generations: trace.generations.length,
    totalTokens: trace.totalTokens,
    models: trace.models,
    ...(trace.inProgress ? { inProgress: true } : {}),
    depth: depthOf(trace.traceId, parents),
  }));
}

/** Ancestors counted only while present in the collection; cycle-guarded. */
function depthOf(id: string, parents: Map<string, string | undefined>): number {
  const seen = new Set([id]);
  let depth = 0;
  for (let cur = parents.get(id); cur !== undefined && parents.has(cur) && !seen.has(cur); ) {
    depth++;
    seen.add(cur);
    cur = parents.get(cur);
  }
  return depth;
}
