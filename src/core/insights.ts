import type { NormalizedTrace } from "./types";

export interface GenerationTokens {
  index: number;
  cached: number;
  fresh: number;
}

export interface SegmentTime {
  segment: number;
  /** Time spent waiting for the first token (prompt processing). */
  promptWait: number;
  /** Generation time after the first token. */
  generation: number;
  /** Latency of generations that report no ttft - split unknown. */
  unattributed: number;
}

export interface Insights {
  perGeneration: GenerationTokens[];
  perSegment: SegmentTime[];
  /** Share of ttft-reporting latency spent waiting for the first token. */
  promptWaitShare: number | null;
  /** Input tokens that were repeated, cache-eligible prefix. */
  cachedTokens: number;
  inputTokens: number;
  /** Fresh input paid at conversation starts after the first - the resent fixed prefix. */
  prefixRepaid: number;
}

/** Derives cross-generation analytics shared by the viewer and CLI. */
export function computeInsights(trace: NormalizedTrace): Insights {
  const perGeneration = trace.generations.map((gen) => ({
    index: gen.index,
    cached: gen.breakdown.cacheableTokens,
    fresh: gen.metrics.inputTokens - gen.breakdown.cacheableTokens,
  }));

  const segments = new Map<number, SegmentTime>();
  const seenSegments = new Set<number>();
  let prefixRepaid = 0;
  trace.generations.forEach((gen, i) => {
    const entry = segments.get(gen.segment) ?? {
      segment: gen.segment,
      promptWait: 0,
      generation: 0,
      unattributed: 0,
    };
    const ttft = gen.metrics.timeToFirstToken;
    if (ttft !== undefined) {
      entry.promptWait += ttft;
      entry.generation += Math.max(gen.metrics.latency - ttft, 0);
    } else {
      entry.unattributed += gen.metrics.latency;
    }
    segments.set(gen.segment, entry);

    if (!seenSegments.has(gen.segment)) {
      seenSegments.add(gen.segment);
      if (gen.segment > 0) prefixRepaid += perGeneration[i]!.fresh;
    }
  });

  const withTtft = trace.generations.filter((g) => g.metrics.timeToFirstToken !== undefined);
  const ttftSum = withTtft.reduce((a, g) => a + g.metrics.timeToFirstToken!, 0);
  const latencySum = withTtft.reduce((a, g) => a + g.metrics.latency, 0);

  return {
    perGeneration,
    perSegment: [...segments.values()].sort((a, b) => a.segment - b.segment),
    promptWaitShare: latencySum > 0 ? ttftSum / latencySum : null,
    cachedTokens: perGeneration.reduce((a, g) => a + g.cached, 0),
    inputTokens: trace.generations.reduce((a, g) => a + g.metrics.inputTokens, 0),
    prefixRepaid,
  };
}
