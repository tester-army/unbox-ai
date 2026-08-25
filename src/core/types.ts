/** Raw trace file format (gateway export). */
export interface RawTrace {
  trace_id: string;
  timestamp: string;
  name: string;
  total_tokens: { input: number; output: number };
  total_cost: number;
  /** Adapter-provided: a generation is still running (live devtools). */
  in_progress?: boolean;
  events: RawEvent[];
}

export interface RawEvent {
  type: string;
  name: string;
  model: string;
  provider: string;
  /** Adapter-provided: started but not finished (live devtools). */
  in_progress?: boolean;
  metrics: {
    latency: number;
    time_to_first_token?: number;
    tokens: {
      input: number;
      output: number;
      /** Provider-reported cache-read tokens, when the trace has real numbers. */
      cache_read?: number;
      /** Provider-reported reasoning share of output tokens. */
      reasoning?: number;
    };
    cost: number;
  };
  available_tools?: RawToolDef[];
  messages: RawMessage[];
}

export interface RawToolDef {
  type: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface RawMessage {
  role: string;
  content: unknown;
  tool_calls?: RawToolCall[];
  tool_call_id?: string;
  /** Adapter-provided tool execution time, when the source trace reports one. */
  duration_ms?: number;
  /** Adapter-provided tool outcome, when the source trace reports one. */
  success?: boolean;
}

export interface RawToolCall {
  type: string;
  id: string;
  function: { name: string; arguments: unknown };
}

/** Normalized trace served to the viewer and printed by the CLI. */
export interface NormalizedTrace {
  traceId: string;
  name: string;
  timestamp: string;
  totalTokens: { input: number; output: number };
  totalCost: number;
  totalLatency: number;
  models: string[];
  segmentCount: number;
  /** True while a generation of this trace is still running (live devtools). */
  inProgress?: boolean;
  generations: Generation[];
}

export interface Generation {
  index: number;
  /** Conversation thread this generation belongs to; increments on context reset. */
  segment: number;
  name: string;
  model: string;
  provider: string;
  metrics: {
    latency: number;
    /** Absent when the trace does not report it. */
    timeToFirstToken?: number;
    inputTokens: number;
    outputTokens: number;
    /** Provider-reported reasoning share of output tokens, when known. */
    reasoningTokens?: number;
    cost: number;
  };
  toolCount: number;
  /** True while the generation is still running (live devtools). */
  inProgress?: boolean;
  /** Count of context messages carried over from previous generations. */
  carriedMessages: number;
  /** Tool results folded into their calls instead of shown as messages. */
  foldedResults: number;
  /** Messages new in this generation vs the previous one (tool results folded into their calls). */
  newMessages: Message[];
  /** Input-token attribution for the treemap. */
  breakdown: TokenBreakdown;
}

export type MessageRole = "system" | "user" | "assistant" | "tool-result" | "unknown";

export interface Message {
  /** Position in the raw event messages array. */
  index: number;
  role: MessageRole;
  text: string;
  /**
   * Reasoning/thinking content, split out of the message text. Empty string
   * when the provider reported thinking but withheld its content.
   */
  reasoning?: string;
  toolCalls?: PairedToolCall[];
  /** Rough size estimate (chars/4), not scaled to reported totals. */
  approxTokens: number;
}

export interface PairedToolCall {
  id: string;
  name: string;
  args: unknown;
  result?: string;
  /** Where the paired result lives in the raw trace, for building `get` pointers. */
  resultRef?: { event: number; message: number };
  /** Tool execution time in ms, when the result payload reports one (tMs). */
  durationMs?: number;
  /** Whether the tool reported success, when the result payload says. */
  success?: boolean;
}

export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  /**
   * Cached-prefix input tokens. When the trace reports real cache reads
   * (cache_read), this is that number, clamped to the request's input.
   * Otherwise it is inferred: on an unmutated continuation, the
   * predecessor's reported input; after compaction, a char-proportional
   * estimate up to the first rewrite; 0 on a segment start, which is
   * conservative - system prompt and tool definitions may still
   * prefix-match across segments.
   */
  cacheableTokens: number;
  groups: BreakdownGroup[];
}

export type BreakdownGroupKey = "system" | "tools" | "conversation";

export interface BreakdownGroup {
  key: BreakdownGroupKey;
  estTokens: number;
  items: BreakdownItem[];
}

export interface BreakdownItem {
  /** Stable identity across generations, e.g. "tool:ui_fill", "system:0:1", "msg:0:4". */
  id: string;
  label: string;
  role?: MessageRole;
  /** Segment the item belongs to; absent for tools, which are segment-independent. */
  segment?: number;
  /** True when the item is part of the repeated, cache-eligible prefix of this request. */
  cached: boolean;
  /** Raw-trace pointer to the full definition, e.g. "events[3].available_tools[7]". */
  ref: string;
  chars: number;
  /** Scaled so all items of a generation sum to reported input tokens. */
  estTokens: number;
  /** Raw content preview for the inspector. */
  preview: string;
}
