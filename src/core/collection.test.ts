import { describe, expect, it } from "vitest";
import { parseCollection, runSummaries } from "./collection";
import { normalizeTrace } from "./normalize";
import type { RawTrace } from "./types";

const GATEWAY = {
  trace_id: "g1",
  timestamp: "2026-08-25T10:00:00.000Z",
  name: "gateway trace",
  total_tokens: { input: 1, output: 1 },
  total_cost: 0.1,
  events: [
    {
      type: "generation",
      name: "agent",
      model: "m",
      provider: "p",
      metrics: { latency: 1, tokens: { input: 1, output: 1 }, cost: 0.1 },
      messages: [{ role: "user", content: "hi" }],
    },
  ],
};

describe("parseCollection", () => {
  it("wraps single-trace formats in a one-item collection", () => {
    const collection = parseCollection(GATEWAY);
    expect(collection.format).toBe("gateway");
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0]!.trace.traceId).toBe("g1");
  });

  it("throws a readable error for unknown formats", () => {
    expect(() => parseCollection({ nonsense: true })).toThrow(/Known formats/);
  });
});

describe("runSummaries", () => {
  function item(id: string, parent?: string) {
    const raw: RawTrace = {
      trace_id: id,
      timestamp: "2026-08-25T10:00:00.000Z",
      name: id,
      total_tokens: { input: 0, output: 0 },
      total_cost: 0,
      ...(parent !== undefined ? { parent_trace_id: parent } : {}),
      events: [],
    };
    return { raw, trace: normalizeTrace(raw) };
  }

  it("computes nesting depth from lineage within the collection", () => {
    const summaries = runSummaries([
      item("root"),
      item("child", "root"),
      item("grandchild", "child"),
      item("stray", "not-here"),
    ]);
    expect(summaries.map((s) => [s.id, s.depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      // an ancestor outside the collection contributes no depth
      ["stray", 0],
    ]);
  });

  it("passes the source path through for tab grouping", () => {
    const sourced = { ...item("a"), sourcePath: "/tmp/a.json" };
    const summaries = runSummaries([sourced, item("b")]);
    expect(summaries[0]!.source).toBe("/tmp/a.json");
    expect(summaries[1]!.source).toBeUndefined();
  });

  it("survives lineage cycles", () => {
    const a = item("a", "b");
    const b = item("b", "a");
    expect(() => runSummaries([a, b])).not.toThrow();
  });
});
