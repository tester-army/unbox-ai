import type { NormalizedTrace } from "@core/types";

export interface GenerationTokens {
  index: number;
  cached: number;
  fresh: number;
}

export interface SegmentTime {
  segment: number;
  name: string;
  /** Time spent waiting for the first token (prompt processing). */
  promptWait: number;
  /** Remaining generation time (or full latency when ttft is unreported). */
  generation: number;
}

export interface Insights {
  perGeneration: GenerationTokens[];
  perSegment: SegmentTime[];
  /** Share of total latency spent waiting for the first token, when reported. */
  promptWaitShare: number | null;
  /** Share of input tokens that were repeated, cache-eligible prefix. */
  cachedShare: number;
  /** Input tokens re-paid at fresh conversation starts after the first. */
  prefixRepaid: number;
}

/** Derives the insight charts' data from a normalized trace. */
export function computeInsights(trace: NormalizedTrace): Insights {
  const perGeneration = trace.generations.map((gen) => {
    const cached = Math.min(gen.breakdown.cacheableTokens, gen.metrics.inputTokens);
    return { index: gen.index, cached, fresh: gen.metrics.inputTokens - cached };
  });

  const segments = new Map<number, SegmentTime>();
  for (const gen of trace.generations) {
    const entry = segments.get(gen.segment) ?? {
      segment: gen.segment,
      name: gen.name,
      promptWait: 0,
      generation: 0,
    };
    const ttft = gen.metrics.timeToFirstToken;
    entry.promptWait += ttft ?? 0;
    entry.generation += ttft !== undefined ? Math.max(gen.metrics.latency - ttft, 0) : gen.metrics.latency;
    segments.set(gen.segment, entry);
  }

  const withTtft = trace.generations.filter((g) => g.metrics.timeToFirstToken !== undefined);
  const ttftSum = withTtft.reduce((a, g) => a + g.metrics.timeToFirstToken!, 0);
  const latencySum = withTtft.reduce((a, g) => a + g.metrics.latency, 0);

  const inputSum = trace.generations.reduce((a, g) => a + g.metrics.inputTokens, 0);
  const cachedSum = perGeneration.reduce((a, g) => a + g.cached, 0);

  const seenSegments = new Set<number>();
  let prefixRepaid = 0;
  for (const gen of trace.generations) {
    const firstOfSegment = !seenSegments.has(gen.segment);
    seenSegments.add(gen.segment);
    if (firstOfSegment && gen.segment > 0 && gen.breakdown.cacheableTokens === 0) {
      prefixRepaid += gen.metrics.inputTokens;
    }
  }

  return {
    perGeneration,
    perSegment: [...segments.values()].sort((a, b) => a.segment - b.segment),
    promptWaitShare: latencySum > 0 ? ttftSum / latencySum : null,
    cachedShare: inputSum > 0 ? cachedSum / inputSum : 0,
    prefixRepaid,
  };
}
