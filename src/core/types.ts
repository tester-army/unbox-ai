/** Raw trace file format (gateway export). */
export interface RawTrace {
  trace_id: string;
  timestamp: string;
  name: string;
  total_tokens: { input: number; output: number };
  total_cost: number;
  events: RawEvent[];
}

export interface RawEvent {
  type: string;
  name: string;
  model: string;
  provider: string;
  metrics: {
    latency: number;
    time_to_first_token?: number;
    tokens: { input: number; output: number };
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
    cost: number;
  };
  toolCount: number;
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
   * Input tokens that are an identical prefix of the previous request -
   * exactly the previous request's reported input - and therefore
   * cache-eligible. 0 on a segment start, which is conservative: the system
   * prompt and tool definitions may still prefix-match across segments.
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
