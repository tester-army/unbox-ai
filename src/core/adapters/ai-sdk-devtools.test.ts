import { describe, expect, it } from "vitest";
import { normalizeTrace } from "../normalize";
import { aiSdkDevtoolsAdapter } from "./ai-sdk-devtools";

interface StepOverrides {
  run_id?: string;
  step_number?: number;
  model_id?: string;
  duration_ms?: number | null;
  input?: unknown;
  output?: unknown;
  usage?: unknown;
  error?: string | null;
}

const SYSTEM = { role: "system", content: "You are a weather bot." };
const USER = { role: "user", content: [{ type: "text", text: "Weather in SF?" }] };
const ASSISTANT_CALL = {
  role: "assistant",
  content: [
    { type: "reasoning", text: "Need the tool." },
    { type: "tool-call", toolCallId: "call_1", toolName: "getWeather", input: { city: "SF" } },
  ],
};
const TOOL_RESULT = {
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "getWeather",
      output: { type: "json", value: { tempC: 18 } },
    },
  ],
};
const ASSISTANT_ANSWER = {
  role: "assistant",
  content: [{ type: "text", text: "18C and sunny." }],
};

const USAGE = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 20,
  outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
  totalTokens: 120,
};

function step(overrides: StepOverrides = {}) {
  const { input, output, usage, ...rest } = overrides;
  return {
    id: `step-${rest.run_id ?? "r1"}-${rest.step_number ?? 1}`,
    run_id: "r1",
    step_number: 1,
    type: "generate",
    model_id: "test-model",
    provider: "test",
    started_at: "2026-08-25T10:00:00.000Z",
    duration_ms: 150,
    input: JSON.stringify(input ?? { prompt: [SYSTEM, USER] }),
    output: output === null ? null : JSON.stringify(output ?? { response: { messages: [] } }),
    usage: usage === null ? null : JSON.stringify(usage ?? USAGE),
    error: null,
    ...rest,
  };
}

function run(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    started_at: "2026-08-25T10:00:00.000Z",
    parent_run_id: null,
    parent_step_id: null,
    function_id: null,
    ...extra,
  };
}

/** A two-step tool-using run: the shape the telemetry integration writes. */
function twoStepDb() {
  return {
    runs: [run("r1")],
    steps: [
      step({
        step_number: 1,
        input: { prompt: [SYSTEM, USER], tools: [{ name: "getWeather", description: "d" }] },
        output: { response: { messages: [ASSISTANT_CALL, TOOL_RESULT] } },
      }),
      step({
        step_number: 2,
        input: { prompt: [SYSTEM, USER, ASSISTANT_CALL, TOOL_RESULT] },
        output: { response: { messages: [ASSISTANT_ANSWER] } },
        usage: { ...USAGE, inputTokens: 130, inputTokenDetails: { cacheReadTokens: 100 } },
      }),
    ],
  };
}

describe("detect", () => {
  it("accepts a devtools database", () => {
    expect(aiSdkDevtoolsAdapter.detect(twoStepDb())).toBe(true);
    expect(aiSdkDevtoolsAdapter.detect({ runs: [], steps: [] })).toBe(true);
  });

  it("rejects other trace shapes", () => {
    expect(aiSdkDevtoolsAdapter.detect({ events: [] })).toBe(false);
    expect(aiSdkDevtoolsAdapter.detect({ info: {}, messages: [] })).toBe(false);
    expect(aiSdkDevtoolsAdapter.detect({ runs: [{}], steps: [] })).toBe(false);
    expect(aiSdkDevtoolsAdapter.detect(null)).toBe(false);
  });
});

describe("adapt", () => {
  it("keeps a multi-step run in one segment with paired tool calls", () => {
    const trace = normalizeTrace(aiSdkDevtoolsAdapter.adapt(twoStepDb()));
    expect(trace.segmentCount).toBe(1);
    expect(trace.generations).toHaveLength(2);

    const [first, second] = trace.generations;
    expect(first!.carriedMessages).toBe(0);
    // the step's own response rides in its snapshot; next step carries it all
    expect(second!.carriedMessages).toBe(4);

    const call = first!.newMessages.find((m) => m.toolCalls)?.toolCalls?.[0];
    expect(call?.name).toBe("getWeather");
    expect(call?.result).toContain("tempC");
    // paired results fold under their call instead of rendering as messages
    expect(first!.foldedResults).toBe(1);
  });

  it("splits reasoning out of assistant text", () => {
    const trace = normalizeTrace(aiSdkDevtoolsAdapter.adapt(twoStepDb()));
    const assistant = trace.generations[0]!.newMessages.at(-1)!;
    expect(assistant.reasoning).toBe("Need the tool.");
    expect(assistant.text).not.toContain("Need the tool.");
  });

  it("maps usage: totals, cache reads, reasoning tokens", () => {
    const trace = normalizeTrace(aiSdkDevtoolsAdapter.adapt(twoStepDb()));
    const [first, second] = trace.generations;
    expect(first!.metrics.inputTokens).toBe(100);
    expect(first!.metrics.reasoningTokens).toBe(5);
    expect(second!.metrics.inputTokens).toBe(130);
    expect(second!.breakdown.cacheableTokens).toBe(100);
  });

  it("handles legacy and provider-level usage shapes", () => {
    const legacy = normalizeTrace(
      aiSdkDevtoolsAdapter.adapt({
        runs: [run("r1")],
        steps: [step({ usage: { inputTokens: 50, outputTokens: 5, cachedInputTokens: 30 } })],
      }),
    );
    expect(legacy.generations[0]!.metrics.inputTokens).toBe(50);
    expect(legacy.generations[0]!.breakdown.cacheableTokens).toBe(30);

    const v4 = normalizeTrace(
      aiSdkDevtoolsAdapter.adapt({
        runs: [run("r1")],
        steps: [
          step({
            usage: {
              inputTokens: { total: 70, cacheRead: 40 },
              outputTokens: { total: 7, reasoning: 2 },
            },
          }),
        ],
      }),
    );
    expect(v4.generations[0]!.metrics.inputTokens).toBe(70);
    expect(v4.generations[0]!.metrics.reasoningTokens).toBe(2);
  });

  it("reconstructs middleware-shaped outputs (parts + stringified args)", () => {
    const trace = normalizeTrace(
      aiSdkDevtoolsAdapter.adapt({
        runs: [run("r1")],
        steps: [
          step({
            output: {
              textParts: [{ text: "partial" }],
              toolCalls: [
                { type: "tool-call", toolCallId: "c1", toolName: "grep", input: '{"q":"x"}' },
              ],
            },
          }),
        ],
      }),
    );
    const assistant = trace.generations[0]!.newMessages.at(-1)!;
    expect(assistant.text).toBe("partial");
    expect(assistant.toolCalls?.[0]?.args).toEqual({ q: "x" });
  });

  it("marks in-flight steps and errored steps", () => {
    const trace = normalizeTrace(
      aiSdkDevtoolsAdapter.adapt({
        runs: [run("r1")],
        steps: [
          step({ step_number: 1, duration_ms: null, output: null, usage: null }),
          step({ step_number: 2, error: "boom", output: null, usage: null }),
        ],
      }),
    );
    expect(trace.inProgress).toBe(true);
    expect(trace.generations[0]!.inProgress).toBe(true);
    expect(trace.generations[1]!.inProgress).toBeUndefined();
    expect(trace.generations[1]!.newMessages.at(-1)!.text).toContain("[error] boom");
  });
});

describe("split", () => {
  it("emits one part per run, children right after their parent", () => {
    const parts = aiSdkDevtoolsAdapter.split!({
      runs: [
        run("a"),
        run("b"),
        run("a-child", { parent_run_id: "a", parent_step_id: "step-a-1" }),
      ],
      steps: [step({ run_id: "a" }), step({ run_id: "b" }), step({ run_id: "a-child" })],
    });
    expect(parts.map((p) => p.runs[0]!.id)).toEqual(["a", "a-child", "b"]);
    for (const part of parts) {
      expect(part.steps.every((s) => s.run_id === part.runs[0]!.id)).toBe(true);
    }
  });

  it("treats a run with an unknown parent as a root", () => {
    const parts = aiSdkDevtoolsAdapter.split!({
      runs: [run("orphan", { parent_run_id: "gone" })],
      steps: [step({ run_id: "orphan" })],
    });
    expect(parts).toHaveLength(1);
  });

  it("records lineage on child parts", () => {
    const [child] = aiSdkDevtoolsAdapter.split!({
      runs: [run("child", { parent_run_id: "parent" })],
      steps: [step({ run_id: "child" })],
    }).map((part) => aiSdkDevtoolsAdapter.adapt(part));
    expect(child!.parent_trace_id).toBe("parent");
  });

  it("returns no parts for an empty database", () => {
    expect(aiSdkDevtoolsAdapter.split!({ runs: [], steps: [] })).toEqual([]);
  });
});

describe("trace naming", () => {
  it("labels a run by its last user message, collapsed and capped", () => {
    const raw = aiSdkDevtoolsAdapter.adapt({
      runs: [run("r1")],
      steps: [
        step({
          input: { prompt: [{ role: "user", content: `##  Title\n\n${"x".repeat(100)}` }] },
        }),
      ],
    });
    expect(raw.name.startsWith("## Title x")).toBe(true);
    expect(raw.name.length).toBeLessThanOrEqual(83);
  });

  it("prefers function_id and falls back for merged databases", () => {
    const named = aiSdkDevtoolsAdapter.adapt({
      runs: [run("r1", { function_id: "qa-agent" })],
      steps: [step({})],
    });
    expect(named.name).toBe("qa-agent");

    const merged = aiSdkDevtoolsAdapter.adapt({
      runs: [run("a"), run("b")],
      steps: [step({ run_id: "a" }), step({ run_id: "b" })],
    });
    expect(merged.name).toBe("AI SDK devtools session");
  });
});
