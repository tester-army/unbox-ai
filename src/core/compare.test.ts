import { describe, expect, it } from "vitest";
import { compareTraces } from "./compare";
import { diffLines } from "./diff";
import { normalizeTrace } from "./normalize";
import type { RawToolDef, RawTrace } from "./types";

function rawTrace(options: {
  id: string;
  system?: string;
  tools?: RawToolDef[];
  events?: number;
  inputTokens?: number;
  cost?: number;
}): RawTrace {
  const events = options.events ?? 1;
  return {
    trace_id: options.id,
    timestamp: "2026-08-26T10:00:00.000Z",
    name: options.id,
    total_tokens: { input: (options.inputTokens ?? 10) * events, output: 5 * events },
    total_cost: (options.cost ?? 0) * events,
    events: Array.from({ length: events }, (_, i) => ({
      type: "generation",
      name: "agent",
      model: "m",
      provider: "p",
      metrics: {
        latency: 1,
        tokens: { input: options.inputTokens ?? 10, output: 5 },
        cost: options.cost ?? 0,
      },
      ...(options.tools !== undefined ? { available_tools: options.tools } : {}),
      messages: [
        ...(options.system !== undefined ? [{ role: "system", content: options.system }] : []),
        { role: "user", content: `hi ${i}` },
      ],
    })),
  };
}

function side(raw: RawTrace) {
  return { raw, trace: normalizeTrace(raw) };
}

describe("compareTraces", () => {
  it("computes headline metric deltas", () => {
    const comparison = compareTraces(
      side(rawTrace({ id: "a", events: 2, inputTokens: 100 })),
      side(rawTrace({ id: "b", events: 3, inputTokens: 50 })),
    );
    const metric = (key: string) => comparison.metrics.find((m) => m.key === key)!;
    expect(metric("generations")).toMatchObject({ a: 2, b: 3 });
    expect(metric("input tokens")).toMatchObject({ a: 200, b: 150 });
  });

  it("hides the cost row when neither trace reports prices", () => {
    const free = compareTraces(side(rawTrace({ id: "a" })), side(rawTrace({ id: "b" })));
    expect(free.metrics.some((m) => m.key === "cost")).toBe(false);
    const priced = compareTraces(
      side(rawTrace({ id: "a", cost: 0.1 })),
      side(rawTrace({ id: "b" })),
    );
    expect(priced.metrics.some((m) => m.key === "cost")).toBe(true);
  });

  it("diffs system prompts line by line", () => {
    const comparison = compareTraces(
      side(rawTrace({ id: "a", system: "you are helpful\nbe brief" })),
      side(rawTrace({ id: "b", system: "you are helpful\nbe thorough\nbe brief" })),
    );
    expect(comparison.systemPrompt.same).toBe(false);
    expect(comparison.systemPrompt.addedLines).toBe(1);
    expect(comparison.systemPrompt.removedLines).toBe(0);
    expect(comparison.systemPrompt.lines).toEqual([
      { kind: "same", text: "you are helpful" },
      { kind: "added", text: "be thorough" },
      { kind: "same", text: "be brief" },
    ]);
  });

  it("reports identical prompts without a diff", () => {
    const comparison = compareTraces(
      side(rawTrace({ id: "a", system: "same" })),
      side(rawTrace({ id: "b", system: "same" })),
    );
    expect(comparison.systemPrompt).toMatchObject({ same: true, addedLines: 0 });
    expect(comparison.systemPrompt.lines).toBeUndefined();
  });

  it("classifies tool definitions as added, removed, changed, unchanged", () => {
    const tool = (name: string, description: string): RawToolDef => ({
      type: "function",
      name,
      description,
    });
    const comparison = compareTraces(
      side(
        rawTrace({ id: "a", tools: [tool("keep", "k"), tool("edit", "old"), tool("drop", "d")] }),
      ),
      side(
        rawTrace({ id: "b", tools: [tool("keep", "k"), tool("edit", "new"), tool("add", "a")] }),
      ),
    );
    expect(comparison.tools).toEqual({
      added: ["add"],
      removed: ["drop"],
      changed: ["edit"],
      unchanged: 1,
    });
  });
});

describe("diffLines", () => {
  it("interleaves removals and additions around common lines", () => {
    expect(diffLines(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });

  it("refuses pathologically large inputs instead of stalling", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    expect(diffLines(big, [...big].reverse())).toBeUndefined();
  });
});
