import type { RawEvent, RawMessage, RawTrace } from "../types";

/**
 * Adapter for opencode session exports ({info, messages[{info, parts}]}).
 * Synthesizes the cumulative-snapshot shape the rest of the pipeline speaks:
 * one event per step-finish, each with the conversation so far. Real cache
 * read/write tokens and per-tool durations carry over.
 */

interface OpencodeExport {
  info: {
    id?: string;
    title?: string;
    slug?: string;
    cost?: number;
    tokens?: OpencodeTokens;
    time?: { created?: number; updated?: number };
  };
  messages: OpencodeMessage[];
}

interface OpencodeTokens {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

interface OpencodeMessage {
  info: {
    role: string;
    agent?: string;
    modelID?: string;
    providerID?: string;
    cost?: number;
    tokens?: OpencodeTokens;
    time?: { created?: number; completed?: number };
  };
  parts: OpencodePart[];
}

interface OpencodePart {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    time?: { start?: number; end?: number };
  };
  tokens?: OpencodeTokens;
  cost?: number;
}

export function isOpencodeTrace(raw: unknown): raw is OpencodeExport {
  const t = raw as Partial<OpencodeExport>;
  return (
    typeof t === "object" &&
    t !== null &&
    Array.isArray(t.messages) &&
    t.messages.every((m) => Array.isArray((m as OpencodeMessage)?.parts))
  );
}

export function adaptOpencodeTrace(oc: OpencodeExport): RawTrace {
  const conversation: RawMessage[] = [];
  const events: RawEvent[] = [];

  for (const message of oc.messages) {
    if (message.info.role !== "assistant") {
      const text = joinText(message.parts);
      conversation.push({ role: message.info.role, content: text });
      continue;
    }
    const steps = splitSteps(message.parts);
    const duration = messageSeconds(message) / Math.max(steps.length, 1);
    for (const step of steps) {
      const finish = step.find((p) => p.type === "step-finish");
      const tools = step.filter((p) => p.type === "tool");
      conversation.push(assistantMessage(step, tools));
      events.push({
        type: "generation",
        name: message.info.agent ?? "assistant",
        model: `${message.info.providerID ?? "unknown"}/${message.info.modelID ?? "unknown"}`,
        provider: message.info.providerID ?? "unknown",
        metrics: {
          latency: duration,
          tokens: totalTokens(finish?.tokens ?? message.info.tokens),
          cost: finish?.cost ?? message.info.cost ?? 0,
        },
        messages: [...conversation],
      });
      // results land after the response, i.e. in the next snapshot
      for (const tool of tools) {
        conversation.push({
          role: "tool",
          content: stringify(tool.state?.output),
          tool_call_id: tool.callID,
          duration_ms: toolMs(tool),
          success: tool.state?.status === "error" ? false : tool.state?.status === "completed",
        });
      }
    }
  }

  return {
    trace_id: oc.info.id ?? "opencode-session",
    timestamp: new Date(oc.info.time?.created ?? 0).toISOString(),
    name: oc.info.title ?? oc.info.slug ?? "opencode session",
    total_tokens: {
      input: events.reduce((acc, e) => acc + e.metrics.tokens.input, 0),
      output: events.reduce((acc, e) => acc + e.metrics.tokens.output, 0),
    },
    total_cost: oc.info.cost ?? 0,
    events,
  };
}

/** Groups an assistant message's parts into steps, split on step boundaries. */
function splitSteps(parts: OpencodePart[]): OpencodePart[][] {
  const steps: OpencodePart[][] = [];
  let current: OpencodePart[] = [];
  for (const part of parts) {
    current.push(part);
    if (part.type === "step-finish") {
      steps.push(current);
      current = [];
    }
  }
  if (current.some((p) => p.type !== "step-start")) steps.push(current);
  return steps;
}

function assistantMessage(step: OpencodePart[], tools: OpencodePart[]): RawMessage {
  const parts = step
    .filter((p) => (p.type === "text" || p.type === "reasoning") && p.text)
    .map((p) => ({ type: p.type, text: p.text! }));
  return {
    role: "assistant",
    content: parts,
    ...(tools.length
      ? {
          tool_calls: tools.map((tool, i) => ({
            type: "function",
            id: tool.callID ?? `call_${i}`,
            function: { name: tool.tool ?? "unknown", arguments: tool.state?.input },
          })),
        }
      : {}),
  };
}

/** Prompt tokens the request actually processed: fresh input plus cache reads and writes. */
function totalTokens(tokens: OpencodeTokens | undefined): RawEvent["metrics"]["tokens"] {
  const read = tokens?.cache?.read ?? 0;
  const write = tokens?.cache?.write ?? 0;
  return {
    input: (tokens?.input ?? 0) + read + write,
    output: tokens?.output ?? 0,
    ...(read > 0 || write > 0 ? { cache_read: read, cache_write: write } : {}),
  };
}

function messageSeconds(message: OpencodeMessage): number {
  const { created, completed } = message.info.time ?? {};
  if (created === undefined || completed === undefined) return 0;
  return Math.max((completed - created) / 1000, 0);
}

function toolMs(tool: OpencodePart): number | undefined {
  const { start, end } = tool.state?.time ?? {};
  if (start === undefined || end === undefined) return undefined;
  return Math.max(end - start, 0);
}

function joinText(parts: OpencodePart[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n");
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}
