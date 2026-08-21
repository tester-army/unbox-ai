import type {
  BreakdownGroup,
  BreakdownItem,
  Generation,
  Message,
  MessageRole,
  NormalizedTrace,
  PairedToolCall,
  RawEvent,
  RawMessage,
  RawTrace,
} from "./types";

/** Rough chars-per-token ratio used before scaling to reported totals. */
const CHARS_PER_TOKEN = 4;

/**
 * Normalizes a raw trace into the schema shared by the viewer and CLI:
 * detects conversation resets (segments), diffs cumulative message
 * snapshots, pairs tool results with their calls, and attributes input
 * tokens to system prompt / tools / conversation for the treemap.
 */
export function normalizeTrace(raw: RawTrace): NormalizedTrace {
  assertTraceShape(raw);
  const generations: Generation[] = [];
  let segment = 0;
  let prev: RawEvent | undefined;

  raw.events.forEach((event, index) => {
    const continuesPrev = prev !== undefined && isPrefix(prev.messages, event.messages);
    if (prev !== undefined && !continuesPrev) segment += 1;
    const carried = continuesPrev && prev !== undefined ? prev.messages.length : 0;
    generations.push(normalizeEvent(event, index, segment, carried));
    prev = event;
  });

  return {
    traceId: raw.trace_id,
    name: raw.name,
    timestamp: raw.timestamp,
    totalTokens: raw.total_tokens,
    totalCost: raw.total_cost,
    totalLatency: sum(generations.map((g) => g.metrics.latency)),
    models: [...new Set(generations.map((g) => g.model))],
    segmentCount: segment + 1,
    generations,
  };
}

/** Throws with a readable message when the file is not a supported trace. */
export function assertTraceShape(raw: unknown): asserts raw is RawTrace {
  const t = raw as Partial<RawTrace>;
  if (typeof t !== "object" || t === null || !Array.isArray(t.events)) {
    throw new Error("Unsupported trace: expected a JSON object with an events[] array");
  }
  for (const [i, event] of t.events.entries()) {
    if (!Array.isArray(event?.messages)) {
      throw new Error(`Unsupported trace: events[${i}] has no messages[] array`);
    }
  }
}

function normalizeEvent(
  event: RawEvent,
  index: number,
  segment: number,
  carried: number,
): Generation {
  const results = collectToolResults(event.messages);
  const newMessages = event.messages
    .slice(carried)
    .map((message, offset) => normalizeMessage(message, carried + offset, results))
    .filter((message) => message.role !== "tool-result");

  return {
    index,
    segment,
    name: event.name,
    model: event.model,
    provider: event.provider,
    metrics: {
      latency: event.metrics.latency,
      timeToFirstToken: event.metrics.time_to_first_token,
      inputTokens: event.metrics.tokens.input,
      outputTokens: event.metrics.tokens.output,
      cost: event.metrics.cost,
    },
    toolCount: event.available_tools?.length ?? 0,
    carriedMessages: carried,
    newMessages,
    breakdown: buildBreakdown(event, segment),
  };
}

/** True when prev is an exact element-wise prefix of next (same conversation, grown). */
function isPrefix(prev: RawMessage[], next: RawMessage[]): boolean {
  if (prev.length > next.length) return false;
  return prev.every((message, i) => deepEqual(message, next[i]));
}

function collectToolResults(messages: RawMessage[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.tool_call_id !== undefined) {
      results.set(message.tool_call_id, contentToText(message.content));
    }
  }
  return results;
}

function normalizeMessage(
  raw: RawMessage,
  index: number,
  results: Map<string, string>,
): Message {
  const text = contentToText(raw.content);
  const toolCalls = raw.tool_calls?.map(
    (call): PairedToolCall => ({
      id: call.id,
      name: call.function.name,
      args: call.function.arguments,
      result: results.get(call.id),
    }),
  );
  return {
    index,
    role: normalizeRole(raw.role),
    text,
    ...(toolCalls?.length ? { toolCalls } : {}),
    estTokens: Math.round(messageChars(raw) / CHARS_PER_TOKEN),
  };
}

function normalizeRole(role: string): MessageRole {
  if (role === "assistant (tool result)" || role === "tool") return "tool-result";
  if (role === "system" || role === "user" || role === "assistant") return role;
  return "user";
}

/** Flattens the content field (string or typed parts array) into plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function messageChars(message: RawMessage): number {
  let chars = contentToText(message.content).length;
  for (const call of message.tool_calls ?? []) {
    chars += call.function.name.length + JSON.stringify(call.function.arguments ?? {}).length;
  }
  return chars;
}

/**
 * Attributes a generation's reported input tokens to system prompt, tool
 * definitions, and conversation messages, proportionally to character
 * counts. The response (final assistant message) is excluded - it is the
 * output, not the input.
 */
function buildBreakdown(event: RawEvent, segment: number): {
  inputTokens: number;
  outputTokens: number;
  groups: BreakdownGroup[];
} {
  const inputMessages = withoutResponse(event.messages);
  const system: BreakdownItem[] = [];
  const conversation: BreakdownItem[] = [];

  inputMessages.forEach((message, index) => {
    const role = normalizeRole(message.role);
    const chars = messageChars(message);
    const item: BreakdownItem = {
      id: `${role === "system" ? "system" : "msg"}:${segment}:${index}`,
      label: role === "system" ? `system #${index + 1}` : `#${index + 1} ${role}`,
      role,
      chars,
      estTokens: 0,
      preview: preview(message),
    };
    (role === "system" ? system : conversation).push(item);
  });

  const tools: BreakdownItem[] = (event.available_tools ?? []).map((tool) => {
    const chars = JSON.stringify(tool).length;
    return {
      id: `tool:${tool.name}`,
      label: tool.name,
      chars,
      estTokens: 0,
      preview: tool.description ?? "",
    };
  });

  scaleToReportedTokens([...system, ...tools, ...conversation], event.metrics.tokens.input);

  const groups: BreakdownGroup[] = [
    { key: "system", estTokens: sumTokens(system), items: system },
    { key: "tools", estTokens: sumTokens(tools), items: tools },
    { key: "conversation", estTokens: sumTokens(conversation), items: conversation },
  ];
  return {
    inputTokens: event.metrics.tokens.input,
    outputTokens: event.metrics.tokens.output,
    groups,
  };
}

/** Drops the trailing assistant response message(s) - they are output, not input. */
function withoutResponse(messages: RawMessage[]): RawMessage[] {
  let end = messages.length;
  while (end > 0 && normalizeRole(messages[end - 1]!.role) === "assistant") end -= 1;
  return messages.slice(0, end);
}

function scaleToReportedTokens(items: BreakdownItem[], inputTokens: number): void {
  const totalChars = sum(items.map((item) => item.chars));
  if (totalChars === 0) return;
  for (const item of items) {
    item.estTokens = Math.round((item.chars / totalChars) * inputTokens);
  }
}

function preview(message: RawMessage): string {
  const text = contentToText(message.content);
  if (text) return text.slice(0, 280);
  const call = message.tool_calls?.[0];
  if (call) return `${call.function.name}(${JSON.stringify(call.function.arguments ?? {})})`.slice(0, 280);
  return "";
}

/** Structural equality; key order must not matter (trace serializers vary it). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function sumTokens(items: BreakdownItem[]): number {
  return sum(items.map((item) => item.estTokens));
}
