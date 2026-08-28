import { describe, expect, it } from "vitest";
import { aggregateBy } from "./aggregate";
import { normalizeTrace } from "./normalize";
import type { RawEvent, RawMessage, RawTrace } from "./types";

function trace(events: RawEvent[]): RawTrace {
  return {
    trace_id: "t1",
    timestamp: "2026-08-25T10:00:00.000Z",
    name: "test",
    total_tokens: { input: 0, output: 0 },
    total_cost: 0,
    events,
  };
}

function event(messages: RawMessage[], overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    type: "generation",
    name: "agent",
    model: "model",
    provider: "provider",
    metrics: { latency: 1, tokens: { input: 10, output: 1 }, cost: 1 },
    messages,
    ...overrides,
  };
}

const USER: RawMessage = { role: "user", content: "hello" };

function sampleTrace() {
  return normalizeTrace(
    trace([
      event([USER], {
        name: "agent-a",
        model: "model-z",
        metrics: { latency: 1, tokens: { input: 10, output: 1 }, cost: 2 },
        available_tools: [{ type: "function", name: "a" }],
      }),
      event([USER], {
        name: "agent-b",
        model: "model-a",
        metrics: { latency: 2, tokens: { input: 20, output: 2 }, cost: 5 },
        available_tools: [
          { type: "function", name: "a" },
          { type: "function", name: "b" },
        ],
      }),
      event([USER], {
        name: "agent-a",
        model: "model-a",
        metrics: { latency: 3, tokens: { input: 30, output: 3 }, cost: 3 },
        available_tools: [
          { type: "function", name: "a" },
          { type: "function", name: "b" },
          { type: "function", name: "c" },
        ],
      }),
      event([USER], {
        name: "agent-c",
        model: "model-z",
        metrics: { latency: 4, tokens: { input: 40, output: 4 }, cost: 6 },
        available_tools: [
          { type: "function", name: "a" },
          { type: "function", name: "b" },
          { type: "function", name: "c" },
          { type: "function", name: "d" },
        ],
      }),
    ]),
  );
}

describe("aggregateBy", () => {
  it("groups and sums by model, sorting by cost with key tie-breaks", () => {
    expect(aggregateBy(sampleTrace(), "model")).toEqual([
      {
        key: "model-a",
        generations: 2,
        inputTokens: 50,
        cachedTokens: 10,
        outputTokens: 5,
        latency: 5,
        cost: 8,
        toolCalls: 5,
      },
      {
        key: "model-z",
        generations: 2,
        inputTokens: 50,
        cachedTokens: 0,
        outputTokens: 5,
        latency: 5,
        cost: 8,
        toolCalls: 5,
      },
    ]);
  });

  it("groups and sums by agent", () => {
    expect(aggregateBy(sampleTrace(), "agent")).toEqual([
      {
        key: "agent-c",
        generations: 1,
        inputTokens: 40,
        cachedTokens: 0,
        outputTokens: 4,
        latency: 4,
        cost: 6,
        toolCalls: 4,
      },
      {
        key: "agent-a",
        generations: 2,
        inputTokens: 40,
        cachedTokens: 10,
        outputTokens: 4,
        latency: 4,
        cost: 5,
        toolCalls: 4,
      },
      {
        key: "agent-b",
        generations: 1,
        inputTokens: 20,
        cachedTokens: 0,
        outputTokens: 2,
        latency: 2,
        cost: 5,
        toolCalls: 2,
      },
    ]);
  });

  it("groups segments in ascending order and labels them by agent", () => {
    expect(aggregateBy(sampleTrace(), "segment")).toEqual([
      {
        key: "0",
        label: "agent-a",
        generations: 2,
        inputTokens: 40,
        cachedTokens: 10,
        outputTokens: 4,
        latency: 4,
        cost: 5,
        toolCalls: 4,
      },
      {
        key: "1",
        label: "agent-b",
        generations: 1,
        inputTokens: 20,
        cachedTokens: 0,
        outputTokens: 2,
        latency: 2,
        cost: 5,
        toolCalls: 2,
      },
      {
        key: "2",
        label: "agent-c",
        generations: 1,
        inputTokens: 40,
        cachedTokens: 0,
        outputTokens: 4,
        latency: 4,
        cost: 6,
        toolCalls: 4,
      },
    ]);
  });

  it("returns no rows for an empty trace", () => {
    expect(aggregateBy(normalizeTrace(trace([])), "model")).toEqual([]);
  });
});
