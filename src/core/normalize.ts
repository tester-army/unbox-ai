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
  const positions = assignSegments(raw.events);
  // Pair per segment: a call made in generation N gets its result from N+1's
  // snapshot, and a segment reset may legitimately reuse tool call ids
  const pairing = collectPairing(raw.events, positions);
  const generations = raw.events.map((event, index) => {
    const pos = positions[index]!;
    // an unmutated continuation resends the thread predecessor's request
    // verbatim, so its cache-eligible prefix is exactly that request's
    // reported input; compaction breaks the cache at the first rewrite,
    // falling back to an estimate of the still-identical leading run
    return normalizeEvent(event, index, pos, pairing, cacheableSpec(pos, raw.events, event));
  });
  const segmentCount = positions.reduce((max, p) => Math.max(max, p.segment + 1), 0);

  return {
    traceId: raw.trace_id,
    name: raw.name,
    timestamp: raw.timestamp,
    totalTokens: raw.total_tokens,
    totalCost: raw.total_cost,
    totalLatency: sum(generations.map((g) => g.metrics.latency)),
    models: [...new Set(generations.map((g) => g.model))],
    segmentCount,
    ...(raw.in_progress ? { inProgress: true } : {}),
    ...(raw.parent_trace_id !== undefined ? { parentTraceId: raw.parent_trace_id } : {}),
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
    const m = event.metrics;
    if (
      typeof m?.tokens?.input !== "number" ||
      typeof m.tokens.output !== "number" ||
      typeof m.latency !== "number" ||
      typeof m.cost !== "number"
    ) {
      throw new Error(`Unsupported trace: events[${i}] is missing metrics (latency, tokens, cost)`);
    }
  }
}

interface EventPosition {
  segment: number;
  /** Count of context messages carried over from the thread predecessor. */
  carried: number;
  /** Index of the event this one continues, when it continues one. */
  prevIndex: number | null;
  /**
   * First carried message whose content was rewritten in place (compaction
   * or a rewritten reminder). Equals carried when the whole prefix is
   * byte-identical.
   */
  firstMutation: number;
}

/**
 * Groups events into conversation threads (segments). Traces interleave
 * agents, so each event is matched against the latest event with the same
 * name; compatibility is structural (roles and tool call ids), tolerating
 * in-place rewrites of older messages (compaction, or a reminder the
 * runtime rewrites each turn).
 */
function assignSegments(events: RawEvent[]): EventPosition[] {
  const positions: EventPosition[] = [];
  let segments = 0;
  events.forEach((event, i) => {
    let found: EventPosition | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (events[j]!.name !== event.name) continue;
      // latest compatible same-name event wins; keep scanning past
      // incompatible tails so rollbacks and parallel same-name threads
      // still find their true predecessor
      const firstMutation = continuationOf(events[j]!.messages, event.messages);
      if (firstMutation !== null) {
        found = {
          segment: positions[j]!.segment,
          carried: events[j]!.messages.length,
          prevIndex: j,
          firstMutation,
        };
        break;
      }
    }
    positions.push(found ?? { segment: segments++, carried: 0, prevIndex: null, firstMutation: 0 });
  });
  return positions;
}

/**
 * Returns the index of the first in-place rewrite (compaction, or a reminder
 * the runtime rewrites each turn) when next continues prev's conversation,
 * prev.length when the prefix is exact, or null when it is a different
 * conversation.
 */
function continuationOf(prev: RawMessage[], next: RawMessage[]): number | null {
  if (prev.length === 0 || prev.length > next.length) return null;
  let firstMutation = prev.length;
  for (let k = 0; k < prev.length; k++) {
    const a = prev[k]!;
    const b = next[k]!;
    if (deepEqual(a, b)) continue;
    // snapshots can catch the newest tool call mid-stream with empty args
    // that the next snapshot completes - the request the provider actually
    // saw had the full args, so this is equality, not a mutation
    if (argsFilledIn(a, b)) continue;
    const structurallySame =
      a.role === b.role &&
      a.tool_call_id === b.tool_call_id &&
      deepEqual(
        a.tool_calls?.map((c) => c.id),
        b.tool_calls?.map((c) => c.id),
      );
    if (structurallySame && (isCompacted(b) || next.length > prev.length)) {
      firstMutation = Math.min(firstMutation, k);
      continue;
    }
    return null;
  }
  return firstMutation;
}

/** True when b is a with previously-empty tool call arguments filled in. */
function argsFilledIn(a: RawMessage, b: RawMessage): boolean {
  if (a.role !== b.role || a.tool_call_id !== b.tool_call_id) return false;
  if (!deepEqual(a.content, b.content)) return false;
  const callsA = a.tool_calls ?? [];
  const callsB = b.tool_calls ?? [];
  if (callsA.length !== callsB.length) return false;
  return callsA.every((call, i) => {
    const other = callsB[i]!;
    if (call.id !== other.id || call.function.name !== other.function.name) return false;
    return (
      deepEqual(call.function.arguments, other.function.arguments) ||
      isEmptyArgs(call.function.arguments)
    );
  });
}

function isEmptyArgs(args: unknown): boolean {
  if (args == null) return true;
  return typeof args === "object" && Object.keys(args).length === 0;
}

/** True for messages the runtime replaced with a "[compacted] ..." summary. */
function isCompacted(message: RawMessage): boolean {
  const text = contentToText(message.content);
  if (text.startsWith("[compacted]")) return true;
  try {
    const value = (JSON.parse(text) as { value?: unknown }).value;
    return typeof value === "string" && value.startsWith("[compacted]");
  } catch {
    return false;
  }
}

/** Names of the tool calls a generation's new messages make, in order. */
export function toolCallNames(gen: Generation): string[] {
  return gen.newMessages.flatMap((m) => m.toolCalls?.map((c) => c.name) ?? []);
}

/** Every tool call in the trace, in order, tagged with its generation index. */
export function allToolCalls(trace: NormalizedTrace): (PairedToolCall & { gen: number })[] {
  return trace.generations.flatMap((gen) =>
    gen.newMessages.flatMap((m) =>
      (m.toolCalls ?? []).map((call) => ({ ...call, gen: gen.index })),
    ),
  );
}

/** Which part of the request is a repeated, cache-eligible prefix. */
interface CacheableSpec {
  /** Exact prefix tokens (the predecessor's reported input), when unmutated. */
  exactTokens?: number;
  /** Messages below this index are cached; compaction breaks the cache here. */
  uptoMessage: number;
  /** Tool definitions are part of the resent prefix on any continuation. */
  toolsCached: boolean;
}

function cacheableSpec(pos: EventPosition, events: RawEvent[], event: RawEvent): CacheableSpec {
  // provider-reported cache reads beat any inference
  const reported = event.metrics.tokens.cache_read;
  const exactReported =
    reported !== undefined
      ? { exactTokens: Math.min(reported, event.metrics.tokens.input) }
      : undefined;
  if (pos.prevIndex === null || pos.carried === 0) {
    return { uptoMessage: 0, toolsCached: false, ...exactReported };
  }
  const prev = events[pos.prevIndex]!;
  // the predecessor's response was never in a prior request - it is fresh
  // input here, so the cached prefix stops before it
  const uptoMessage = Math.min(pos.firstMutation, withoutResponse(prev.messages).length);
  const unmutated = pos.firstMutation >= pos.carried;
  return {
    uptoMessage,
    toolsCached: true,
    ...(exactReported ??
      (unmutated
        ? {
            // provider token reporting is not monotonic: clamp to this request's input
            exactTokens: Math.min(prev.metrics.tokens.input, event.metrics.tokens.input),
          }
        : {})),
  };
}

function normalizeEvent(
  event: RawEvent,
  index: number,
  { segment, carried }: EventPosition,
  pairing: Pairing,
  cacheable: CacheableSpec,
): Generation {
  const rawNew = event.messages.length - carried;
  const newMessages = event.messages
    .slice(carried)
    .map((message, offset) => ({ raw: message, index: carried + offset }))
    // paired results render inline under their call; orphans stay visible
    .filter(
      ({ raw }) => !(isToolResult(raw) && pairing.callIds.has(`${segment}:${raw.tool_call_id}`)),
    )
    .map(({ raw, index }) => normalizeMessage(raw, index, segment, pairing));

  return {
    index,
    segment,
    name: event.name,
    model: event.model,
    provider: event.provider,
    metrics: {
      latency: event.metrics.latency,
      ...(event.metrics.time_to_first_token !== undefined
        ? { timeToFirstToken: event.metrics.time_to_first_token }
        : {}),
      inputTokens: event.metrics.tokens.input,
      outputTokens: event.metrics.tokens.output,
      ...(event.metrics.tokens.reasoning !== undefined
        ? { reasoningTokens: event.metrics.tokens.reasoning }
        : {}),
      cost: event.metrics.cost,
    },
    toolCount: event.available_tools?.length ?? 0,
    ...(event.in_progress ? { inProgress: true } : {}),
    carriedMessages: carried,
    foldedResults: rawNew - newMessages.length,
    newMessages,
    breakdown: buildBreakdown(event, index, segment, cacheable),
  };
}

interface ToolResult {
  text: string;
  /** Event and message index of the result's first appearance in the raw trace. */
  ref: { event: number; message: number };
  /** Adapter-provided execution metadata, when the source trace reports it. */
  durationMs?: number;
  success?: boolean;
}

interface Pairing {
  /** Every tool call id made anywhere in the trace, keyed "segment:id". */
  callIds: Set<string>;
  /** Result of each call, keyed "segment:id". */
  results: Map<string, ToolResult>;
  /**
   * First non-empty arguments seen per call, keyed "segment:id". Streaming
   * snapshots capture the newest call with empty args; a later snapshot has
   * the completed value.
   */
  args: Map<string, unknown>;
}

function isToolResult(message: RawMessage): message is RawMessage & { tool_call_id: string } {
  return normalizeRole(message.role) === "tool-result" && message.tool_call_id !== undefined;
}

function collectPairing(events: RawEvent[], positions: EventPosition[]): Pairing {
  const callIds = new Set<string>();
  const results = new Map<string, ToolResult>();
  const args = new Map<string, unknown>();
  events.forEach((event, eventIndex) => {
    const segment = positions[eventIndex]!.segment;
    event.messages.forEach((message, messageIndex) => {
      for (const call of message.tool_calls ?? []) {
        const key = `${segment}:${call.id}`;
        callIds.add(key);
        if (!args.has(key) && !isEmptyArgs(call.function.arguments)) {
          args.set(key, call.function.arguments);
        }
      }
      if (isToolResult(message) && !results.has(`${segment}:${message.tool_call_id}`)) {
        results.set(`${segment}:${message.tool_call_id}`, {
          text: contentToText(message.content),
          ref: { event: eventIndex, message: messageIndex },
          ...(message.duration_ms !== undefined ? { durationMs: message.duration_ms } : {}),
          ...(message.success !== undefined ? { success: message.success } : {}),
        });
      }
    });
  });
  return { callIds, results, args };
}

function normalizeMessage(
  raw: RawMessage,
  index: number,
  segment: number,
  pairing: Pairing,
): Message {
  const { text, reasoning } = splitReasoning(raw.content);
  const toolCalls = raw.tool_calls?.map((call): PairedToolCall => {
    const key = `${segment}:${call.id}`;
    const result = pairing.results.get(key);
    // streaming snapshots capture the newest call with empty args; a later
    // snapshot has the completed value
    const args = isEmptyArgs(call.function.arguments)
      ? (pairing.args.get(key) ?? call.function.arguments)
      : call.function.arguments;
    const requestedWait = requestedWaitMs(call.function.name, args);
    return {
      id: call.id,
      name: call.function.name,
      args,
      ...(requestedWait !== undefined ? { durationMs: requestedWait } : {}),
      ...(result
        ? {
            result: result.text,
            resultRef: result.ref,
            // adapter-reported metadata beats payload sniffing beats args
            ...resultMeta(result.text),
            ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
            ...(result.success !== undefined ? { success: result.success } : {}),
          }
        : {}),
    };
  });
  return {
    index,
    role: normalizeRole(raw.role),
    text,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(toolCalls?.length ? { toolCalls } : {}),
    approxTokens: Math.round(messageChars(raw) / CHARS_PER_TOKEN),
  };
}

/**
 * Separates reasoning/thinking parts from the rest of a message's content.
 * reasoning is defined (possibly "") only when such parts exist - providers
 * that withhold thinking send parts with empty text.
 */
function splitReasoning(content: unknown): { text: string; reasoning?: string } {
  if (!Array.isArray(content)) return { text: contentToText(content) };
  const isReasoning = (part: unknown): part is { text?: string; thinking?: string } => {
    const type = (part as { type?: unknown })?.type;
    return type === "reasoning" || type === "thinking";
  };
  const parts = content.filter(isReasoning);
  if (parts.length === 0) return { text: contentToText(content) };
  return {
    text: contentToText(content.filter((part) => !isReasoning(part))),
    reasoning: parts
      .map((part) => part.text ?? part.thinking ?? "")
      .join("\n")
      .trim(),
  };
}

/**
 * Pulls execution time and success out of result payloads that report them.
 * Convention from the tester.army tool runtime: results serialized as
 * {"type":"json","value":{...,"tMs":<ms>,"success":<bool>}}.
 */
function resultMeta(text: string): Pick<PairedToolCall, "durationMs" | "success"> {
  try {
    const value = (JSON.parse(text) as { value?: { tMs?: unknown; success?: unknown } }).value;
    const tMs = value?.tMs;
    return {
      ...(typeof tMs === "number" && Number.isFinite(tMs) && tMs >= 0 ? { durationMs: tMs } : {}),
      ...(typeof value?.success === "boolean" ? { success: value.success } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Sleep-style tools (wait_for, sleep, ...) request their duration in args and
 * runtimes rarely report it back - the requested time is the actual time.
 * Only applies to wait/sleep-named tools; reported durations always win.
 */
function requestedWaitMs(name: string, args: unknown): number | undefined {
  if (!/wait|sleep/i.test(name)) return undefined;
  const a = args as Record<string, unknown> | null | undefined;
  const ms = a?.timeMs ?? a?.durationMs ?? a?.ms;
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

function normalizeRole(role: string): MessageRole {
  if (role === "assistant (tool result)" || role === "tool") return "tool-result";
  if (role === "system" || role === "user" || role === "assistant") return role;
  // e.g. "assistant (thinking)" - redacted reasoning placeholders
  if (role.startsWith("assistant")) return "assistant";
  return "unknown";
}

/** Flattens the content field (string or typed parts array) into plain text. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        const attachment = attachmentLabel(part);
        if (attachment !== undefined) return attachment;
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

/**
 * Exporters replace binary attachments (screenshots etc.) with stub parts
 * like {"type":"file","mediaType":"image/jpeg","file":"raw files not
 * supported"} - label them instead of dumping the stub JSON. The real bytes
 * (and their token cost) are not in the trace.
 */
function attachmentLabel(part: {
  type?: unknown;
  mediaType?: unknown;
  file?: unknown;
  image?: unknown;
}): string | undefined {
  if (part?.type !== "file" && part?.type !== "image") return undefined;
  const media = typeof part.mediaType === "string" ? part.mediaType : "unknown type";
  const stub = typeof part.file === "string" && part.file.length < 100 ? ` (${part.file})` : "";
  return `[attachment: ${media}${stub} - bytes not included in the trace export]`;
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
function buildBreakdown(
  event: RawEvent,
  eventIndex: number,
  segment: number,
  cacheable: CacheableSpec,
): {
  inputTokens: number;
  outputTokens: number;
  cacheableTokens: number;
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
      segment,
      chars,
      estTokens: 0,
      cached: index < cacheable.uptoMessage,
      ref: `events[${eventIndex}].messages[${index}]`,
      preview: preview(message),
    };
    (role === "system" ? system : conversation).push(item);
  });

  const tools: BreakdownItem[] = (event.available_tools ?? []).map((tool, toolIndex) => {
    const chars = JSON.stringify(tool).length;
    return {
      id: `tool:${tool.name}`,
      label: tool.name,
      chars,
      estTokens: 0,
      cached: cacheable.toolsCached,
      ref: `events[${eventIndex}].available_tools[${toolIndex}]`,
      preview: tool.description ?? "",
    };
  });

  const all = [...system, ...tools, ...conversation];
  const cachedItems = all.filter((item) => item.cached);
  if (cacheable.exactTokens !== undefined && cachedItems.length > 0) {
    // the exact split is known: scale each pool to its true total so the
    // header numbers and the faint/bright areas agree by construction
    scaleToReportedTokens(cachedItems, cacheable.exactTokens);
    scaleToReportedTokens(
      all.filter((item) => !item.cached),
      event.metrics.tokens.input - cacheable.exactTokens,
    );
  } else {
    scaleToReportedTokens(all, event.metrics.tokens.input);
  }

  const groups: BreakdownGroup[] = [
    { key: "system", estTokens: sumTokens(system), items: system },
    { key: "tools", estTokens: sumTokens(tools), items: tools },
    { key: "conversation", estTokens: sumTokens(conversation), items: conversation },
  ];
  // no structurally-cached blocks to scale (e.g. reported cache hits without
  // a detectable carried prefix): fall back to the reported number directly
  const cacheableTokens =
    cachedItems.length > 0 ? sumTokens(cachedItems) : (cacheable.exactTokens ?? 0);

  return {
    inputTokens: event.metrics.tokens.input,
    outputTokens: event.metrics.tokens.output,
    cacheableTokens,
    groups,
  };
}

/**
 * Drops the trailing assistant response - it is output, not input. Trailing
 * tool results are dropped too: they only occur when an adapter appends the
 * final step's results for pairing, and those never reached the model either.
 */
function withoutResponse(messages: RawMessage[]): RawMessage[] {
  let end = messages.length;
  while (end > 0) {
    const role = normalizeRole(messages[end - 1]!.role);
    if (role !== "assistant" && role !== "tool-result") break;
    end -= 1;
  }
  return messages.slice(0, end);
}

function scaleToReportedTokens(items: BreakdownItem[], inputTokens: number): void {
  const totalChars = sum(items.map((item) => item.chars));
  if (totalChars === 0) return;
  // an in-flight generation has no usage yet - keep char-based estimates
  // instead of scaling everything to a reported 0
  if (inputTokens === 0) {
    for (const item of items) item.estTokens = Math.round(item.chars / CHARS_PER_TOKEN);
    return;
  }
  for (const item of items) {
    item.estTokens = Math.round((item.chars / totalChars) * inputTokens);
  }
}

function preview(message: RawMessage): string {
  const text = contentToText(message.content);
  if (text) return text.slice(0, 280);
  const call = message.tool_calls?.[0];
  if (call)
    return `${call.function.name}(${JSON.stringify(call.function.arguments ?? {})})`.slice(0, 280);
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
