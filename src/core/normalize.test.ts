import { describe, expect, it } from "vitest";
import { normalizeTrace } from "./normalize";
import type { RawEvent, RawMessage, RawTrace } from "./types";

function trace(events: RawEvent[], overrides: Partial<RawTrace> = {}): RawTrace {
  return {
    trace_id: "t1",
    timestamp: "2026-08-25T10:00:00.000Z",
    name: "test",
    total_tokens: { input: 0, output: 0 },
    total_cost: 0,
    events,
    ...overrides,
  };
}

function event(messages: RawMessage[], overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    type: "generation",
    name: "agent",
    model: "m",
    provider: "p",
    metrics: { latency: 1, tokens: { input: 100, output: 10 }, cost: 0 },
    messages,
    ...overrides,
  };
}

const SYS: RawMessage = { role: "system", content: "sys prompt" };
const USER: RawMessage = { role: "user", content: "hello" };
const notice = (turn: number): RawMessage => ({
  role: "system",
  content: `[SYSTEM NOTICE] Turn ${turn}.`,
});

describe("segments", () => {
  it("joins continuations and splits resets", () => {
    const reply: RawMessage = { role: "assistant", content: "hi" };
    const normalized = normalizeTrace(
      trace([
        event([SYS, USER]),
        event([SYS, USER, reply, { role: "user", content: "more" }]),
        event([{ role: "user", content: "fresh conversation" }]),
      ]),
    );
    expect(normalized.segmentCount).toBe(2);
    expect(normalized.generations.map((g) => g.segment)).toEqual([0, 0, 1]);
    expect(normalized.generations[1]!.carriedMessages).toBe(2);
  });

  it("joins a continuation with a live-updating system notice", () => {
    const normalized = normalizeTrace(
      trace([
        event([SYS, notice(0), USER]),
        event([
          SYS,
          notice(1),
          USER,
          { role: "assistant", content: "reply" },
          { role: "user", content: "next" },
        ]),
      ]),
    );
    expect(normalized.segmentCount).toBe(1);
    expect(normalized.generations.map((g) => g.segment)).toEqual([0, 0]);
    expect(normalized.generations[1]!.carriedMessages).toBe(3);

    const breakdown = normalized.generations[1]!.breakdown;
    const items = breakdown.groups.flatMap((group) => group.items);
    expect(items.map((item) => item.cached)).toEqual([true, false, false, false, false]);
    expect(breakdown.cacheableTokens).toBe(items[0]!.estTokens);
    expect(breakdown.cacheableTokens).toBeLessThan(
      items.slice(0, 3).reduce((total, item) => total + item.estTokens, 0),
    );
  });

  it("splits a same-shaped restart with changed content", () => {
    const normalized = normalizeTrace(
      trace([
        event([SYS, notice(0), USER, { role: "assistant", content: "reply A" }]),
        event([SYS, notice(0), USER, { role: "assistant", content: "reply B" }]),
      ]),
    );
    expect(normalized.segmentCount).toBe(2);
    expect(normalized.generations.map((g) => g.segment)).toEqual([0, 1]);
  });
});

describe("tool pairing", () => {
  const call: RawMessage = {
    role: "assistant",
    content: "",
    tool_calls: [{ type: "function", id: "c1", function: { name: "grep", arguments: {} } }],
  };
  const result: RawMessage = { role: "tool", content: "match found", tool_call_id: "c1" };

  it("pairs a result from the next snapshot and fills late args", () => {
    const callWithArgs: RawMessage = {
      ...call,
      tool_calls: [
        { type: "function", id: "c1", function: { name: "grep", arguments: { q: "x" } } },
      ],
    };
    const normalized = normalizeTrace(
      trace([event([USER, call]), event([USER, callWithArgs, result])]),
    );
    const paired = normalized.generations[0]!.newMessages.at(-1)!.toolCalls![0]!;
    expect(paired.result).toBe("match found");
    // streaming snapshots capture the newest call with empty args
    expect(paired.args).toEqual({ q: "x" });
    // the result message folds under the call in the later generation
    expect(normalized.generations[1]!.foldedResults).toBe(1);
  });
});

describe("reasoning", () => {
  it("splits reasoning parts out of the text", () => {
    const normalized = normalizeTrace(
      trace([
        event([
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "think first" },
              { type: "text", text: "answer" },
            ],
          },
        ]),
      ]),
    );
    const message = normalized.generations[0]!.newMessages[0]!;
    expect(message.reasoning).toBe("think first");
    expect(message.text).toBe("answer");
  });

  it("keeps withheld reasoning visible as an empty string", () => {
    const normalized = normalizeTrace(
      trace([event([{ role: "assistant", content: [{ type: "reasoning", text: "" }] }])]),
    );
    expect(normalized.generations[0]!.newMessages[0]!.reasoning).toBe("");
  });

  it("leaves plain content untouched", () => {
    const normalized = normalizeTrace(trace([event([USER])]));
    expect(normalized.generations[0]!.newMessages[0]!.reasoning).toBeUndefined();
  });
});

describe("cache attribution", () => {
  it("prefers reported cache reads, clamped to the request's input", () => {
    const normalized = normalizeTrace(
      trace([
        event([SYS, USER], {
          metrics: { latency: 1, tokens: { input: 100, output: 10, cache_read: 250 }, cost: 0 },
        }),
      ]),
    );
    expect(normalized.generations[0]!.breakdown.cacheableTokens).toBe(100);
  });

  it("infers the predecessor's input on an unmutated continuation", () => {
    const reply: RawMessage = { role: "assistant", content: "hi" };
    const normalized = normalizeTrace(
      trace([
        event([SYS, USER]),
        event([SYS, USER, reply], {
          metrics: { latency: 1, tokens: { input: 140, output: 10 }, cost: 0 },
        }),
      ]),
    );
    expect(normalized.generations[1]!.breakdown.cacheableTokens).toBe(100);
  });
});

describe("in-flight generations", () => {
  it("passes flags through and keeps char-based estimates at zero input", () => {
    const normalized = normalizeTrace(
      trace(
        [
          event([SYS, USER], {
            in_progress: true,
            metrics: { latency: 0, tokens: { input: 0, output: 0 }, cost: 0 },
          }),
        ],
        { in_progress: true },
      ),
    );
    expect(normalized.inProgress).toBe(true);
    const generation = normalized.generations[0]!;
    expect(generation.inProgress).toBe(true);
    const estimated = generation.breakdown.groups.flatMap((g) => g.items).map((i) => i.estTokens);
    expect(Math.max(...estimated)).toBeGreaterThan(0);
  });
});

describe("shape validation", () => {
  it("rejects events without messages or metrics", () => {
    expect(() => normalizeTrace(trace([{ metrics: {} } as unknown as RawEvent]))).toThrow(
      /messages/,
    );
  });
});
