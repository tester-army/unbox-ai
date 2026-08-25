import { contentToText } from "../normalize";
import type { RawEvent, RawMessage, RawToolCall, RawToolDef, RawTrace } from "../types";
import type { TraceAdapter } from "./adapter";

/**
 * Adapter for AI SDK devtools databases ({runs[], steps[]}, written by
 * @ai-sdk/devtools to .devtools/generations.json). Each step's input.prompt
 * is already a cumulative snapshot of the conversation; appending the step's
 * own response messages yields the exact shape the pipeline speaks - the
 * next step's prompt repeats prompt + response verbatim, so segment
 * continuation and tool pairing work unchanged.
 *
 * A database holds many independent runs; split() turns each root run (with
 * its nested child runs) into its own trace. adapt() on the whole database
 * still yields one merged trace for the text commands.
 */
export const aiSdkDevtoolsAdapter: TraceAdapter<DevtoolsDb> = {
  name: "ai-sdk-devtools",
  detect: isDevtoolsDb,
  adapt: adaptDevtoolsDb,
  split: splitDevtoolsDb,
};

interface DevtoolsDb {
  runs: DevtoolsRun[];
  steps: DevtoolsStep[];
}

interface DevtoolsRun {
  id: string;
  started_at?: string;
  parent_run_id?: string | null;
  function_id?: string | null;
}

interface DevtoolsStep {
  run_id: string;
  step_number: number;
  model_id?: string;
  provider?: string | null;
  started_at?: string;
  duration_ms?: number | null;
  input: string;
  output?: string | null;
  usage?: string | null;
  error?: string | null;
}

interface DevtoolsMessage {
  role: string;
  content: unknown;
}

interface DevtoolsPart {
  type?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

interface DevtoolsInput {
  prompt?: DevtoolsMessage[];
  tools?: { name?: string; description?: string; parameters?: unknown }[];
}

interface DevtoolsOutput {
  content?: DevtoolsPart[];
  textParts?: { text?: string }[];
  reasoningParts?: { text?: string }[];
  toolCalls?: DevtoolsPart[];
  response?: { messages?: DevtoolsMessage[] };
}

interface DevtoolsUsage {
  inputTokens?: number | { total?: number; cacheRead?: number };
  outputTokens?: number | { total?: number; reasoning?: number };
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  cachedInputTokens?: number;
}

function isDevtoolsDb(raw: unknown): raw is DevtoolsDb {
  const t = raw as Partial<DevtoolsDb>;
  return (
    typeof t === "object" &&
    t !== null &&
    Array.isArray(t.runs) &&
    Array.isArray(t.steps) &&
    t.runs.every((r) => typeof r?.id === "string") &&
    t.steps.every((s) => typeof s?.run_id === "string" && typeof s?.input === "string")
  );
}

/** One part per root run, each carrying the root's nested child runs. */
function splitDevtoolsDb(db: DevtoolsDb): DevtoolsDb[] {
  const known = new Set(db.runs.map((run) => run.id));
  // a run whose parent is not in the file cannot nest anywhere - treat as root
  const roots = db.runs.filter((run) => !run.parent_run_id || !known.has(run.parent_run_id));
  const children = new Map<string, DevtoolsRun[]>();
  for (const run of db.runs) {
    if (run.parent_run_id && known.has(run.parent_run_id)) {
      const siblings = children.get(run.parent_run_id) ?? [];
      siblings.push(run);
      children.set(run.parent_run_id, siblings);
    }
  }
  return roots.map((root) => {
    const runs = [root];
    for (const run of runs) runs.push(...(children.get(run.id) ?? []));
    const ids = new Set(runs.map((run) => run.id));
    return { runs, steps: db.steps.filter((step) => ids.has(step.run_id)) };
  });
}

function adaptDevtoolsDb(db: DevtoolsDb): RawTrace {
  const runs = new Map(db.runs.map((run) => [run.id, run]));
  // file order is append order (steps are written at step start), i.e.
  // chronological even when parent and child runs interleave
  const events = db.steps.map((step) => stepEvent(step, runs.get(step.run_id)));
  const started = [...runs.values()]
    .map((run) => run.started_at)
    .filter((t): t is string => typeof t === "string")
    .sort()[0];
  return {
    trace_id: db.runs[0]?.id ?? "ai-sdk-devtools",
    timestamp: started ?? db.steps[0]?.started_at ?? new Date(0).toISOString(),
    name: traceName(db),
    total_tokens: {
      input: events.reduce((acc, e) => acc + e.metrics.tokens.input, 0),
      output: events.reduce((acc, e) => acc + e.metrics.tokens.output, 0),
    },
    total_cost: 0,
    ...(events.some((e) => e.in_progress) ? { in_progress: true } : {}),
    events,
  };
}

/** A split part is one run - label it by its ask; a merged db keeps the generic name. */
function traceName(db: DevtoolsDb): string {
  const known = new Set(db.runs.map((run) => run.id));
  const roots = db.runs.filter((run) => !run.parent_run_id || !known.has(run.parent_run_id));
  const root = roots.length === 1 ? roots[0]! : undefined;
  if (!root) return "AI SDK devtools session";
  if (root.function_id) return root.function_id;
  const firstStep = db.steps.find((step) => step.run_id === root.id);
  const prompt = parseJson<DevtoolsInput>(firstStep?.input)?.prompt;
  const ask = prompt?.filter((message) => message.role === "user").at(-1);
  const text = ask ? contentToText(ask.content).replace(/\s+/g, " ").trim() : "";
  if (!text) return `run ${root.id.slice(-8)}`;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function stepEvent(step: DevtoolsStep, run: DevtoolsRun | undefined): RawEvent {
  const input = parseJson<DevtoolsInput>(step.input);
  const output = parseJson<DevtoolsOutput>(step.output);
  const response = responseMessages(output);
  const messages = [
    ...(input?.prompt ?? []).flatMap(convertMessage),
    ...response.flatMap(convertMessage),
    ...(step.error && response.length === 0
      ? [{ role: "assistant", content: `[error] ${step.error}` }]
      : []),
  ];
  return {
    type: "generation",
    name: run?.function_id ?? (run?.parent_run_id ? "nested run" : "ai-sdk"),
    model: step.model_id ?? "unknown",
    provider: step.provider ?? "unknown",
    ...(step.duration_ms == null && !step.error && !step.output ? { in_progress: true } : {}),
    metrics: {
      latency: (step.duration_ms ?? 0) / 1000,
      tokens: tokensFrom(parseJson<DevtoolsUsage>(step.usage)),
      // the AI SDK reports token usage, not dollars
      cost: 0,
    },
    ...(input?.tools?.length
      ? {
          available_tools: input.tools.map(
            (tool): RawToolDef => ({
              type: "function",
              name: tool.name ?? "unknown",
              ...(tool.description !== undefined ? { description: tool.description } : {}),
              ...(tool.parameters !== undefined ? { inputSchema: tool.parameters } : {}),
            }),
          ),
        }
      : {}),
    messages,
  };
}

/**
 * The step's own response messages. The telemetry integration writes them
 * verbatim (output.response.messages, including the step's tool results);
 * middleware-written steps only have collected parts to reconstruct from.
 */
function responseMessages(output: DevtoolsOutput | undefined): DevtoolsMessage[] {
  if (!output) return [];
  if (Array.isArray(output.response?.messages)) return output.response.messages;
  const parts: DevtoolsPart[] = [
    ...(output.reasoningParts ?? []).map((p) => ({ type: "reasoning", text: p.text })),
    ...(output.textParts ?? []).map((p) => ({ type: "text", text: p.text })),
    ...(output.toolCalls ?? []),
  ];
  if (parts.length === 0 && Array.isArray(output.content)) {
    parts.push(...output.content.filter((p) => p?.type !== "tool-result"));
  }
  return parts.length ? [{ role: "assistant", content: parts }] : [];
}

/** Splits tool messages into one result per part; extracts assistant tool calls. */
function convertMessage(message: DevtoolsMessage): RawMessage[] {
  if (message.role === "tool" && Array.isArray(message.content)) {
    return (message.content as DevtoolsPart[])
      .filter((part) => part?.type === "tool-result")
      .map(toolResultMessage);
  }
  if (message.role === "assistant" && Array.isArray(message.content)) {
    const parts = message.content as DevtoolsPart[];
    const calls = parts.filter((part) => part?.type === "tool-call");
    return [
      {
        role: "assistant",
        content: parts.filter((part) => part?.type !== "tool-call"),
        ...(calls.length ? { tool_calls: calls.map(toolCall) } : {}),
      },
    ];
  }
  return [{ role: message.role, content: message.content }];
}

function toolCall(part: DevtoolsPart, index: number): RawToolCall {
  return {
    type: "function",
    id: part.toolCallId ?? `call_${index}`,
    function: { name: part.toolName ?? "unknown", arguments: parseArgs(part.input) },
  };
}

/** Middleware-written steps store tool args as JSON strings; telemetry stores objects. */
function parseArgs(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function toolResultMessage(part: DevtoolsPart): RawMessage {
  const output = part.output as { type?: unknown; value?: unknown } | undefined;
  const wrapped =
    output !== null && typeof output === "object" && "value" in output && "type" in output;
  return {
    role: "tool",
    content: wrapped ? output.value : part.output,
    tool_call_id: part.toolCallId,
    ...(wrapped && typeof output.type === "string" && output.type.startsWith("error")
      ? { success: false }
      : {}),
  };
}

/**
 * Handles every usage shape @ai-sdk/devtools has written: current
 * ({inputTokens: n, inputTokenDetails}), provider-level V4 breakdown
 * objects, and legacy {inputTokens, cachedInputTokens}. Totals include
 * cache reads already.
 */
function tokensFrom(usage: DevtoolsUsage | undefined): RawEvent["metrics"]["tokens"] {
  const cacheRead =
    usage?.inputTokenDetails?.cacheReadTokens ??
    (typeof usage?.inputTokens === "object" ? usage.inputTokens?.cacheRead : undefined) ??
    usage?.cachedInputTokens;
  const reasoning =
    usage?.outputTokenDetails?.reasoningTokens ??
    (typeof usage?.outputTokens === "object" ? usage.outputTokens?.reasoning : undefined);
  return {
    input: numberOrTotal(usage?.inputTokens),
    output: numberOrTotal(usage?.outputTokens),
    ...(typeof cacheRead === "number" ? { cache_read: cacheRead } : {}),
    ...(typeof reasoning === "number" && reasoning > 0 ? { reasoning } : {}),
  };
}

function numberOrTotal(value: number | { total?: number } | undefined): number {
  if (typeof value === "number") return value;
  return typeof value?.total === "number" ? value.total : 0;
}

function parseJson<T>(text: string | null | undefined): T | undefined {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
