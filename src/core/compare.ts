import { type DiffLine, diffLines } from "./diff";
import { computeInsights } from "./insights";
import { allToolCalls } from "./normalize";
import type { NormalizedTrace, RawToolDef, RawTrace } from "./types";

/** One side of a comparison: the normalized trace plus its raw form. */
export interface ComparableTrace {
  trace: NormalizedTrace;
  raw: RawTrace;
}

export type MetricKind = "count" | "tokens" | "seconds" | "cost" | "share";

export interface ComparedMetric {
  key: string;
  kind: MetricKind;
  a: number;
  b: number;
}

export interface PromptDiff {
  same: boolean;
  aChars: number;
  bChars: number;
  addedLines: number;
  removedLines: number;
  /** Absent when identical, or when the prompts are too large to diff. */
  lines?: DiffLine[];
}

export interface ToolsDiff {
  added: string[];
  removed: string[];
  /** Same name, different description or input schema. */
  changed: string[];
  unchanged: number;
}

export interface TraceComparison {
  models: { a: string[]; b: string[] };
  metrics: ComparedMetric[];
  systemPrompt: PromptDiff;
  tools: ToolsDiff;
}

/** Diffs two traces: headline metric deltas plus system prompt and tool-set changes. */
export function compareTraces(a: ComparableTrace, b: ComparableTrace): TraceComparison {
  return {
    models: { a: a.trace.models, b: b.trace.models },
    metrics: compareMetrics(a.trace, b.trace),
    systemPrompt: comparePrompts(systemPrompt(a.trace), systemPrompt(b.trace)),
    tools: compareTools(toolDefs(a.raw), toolDefs(b.raw)),
  };
}

function compareMetrics(a: NormalizedTrace, b: NormalizedTrace): ComparedMetric[] {
  const ia = computeInsights(a);
  const ib = computeInsights(b);
  const callsA = allToolCalls(a);
  const callsB = allToolCalls(b);
  const failures = (calls: { success?: boolean }[]) =>
    calls.filter((call) => call.success === false).length;
  const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
  const metrics: ComparedMetric[] = [
    { key: "generations", kind: "count", a: a.generations.length, b: b.generations.length },
    { key: "segments", kind: "count", a: a.segmentCount, b: b.segmentCount },
    { key: "input tokens", kind: "tokens", a: a.totalTokens.input, b: b.totalTokens.input },
    { key: "output tokens", kind: "tokens", a: a.totalTokens.output, b: b.totalTokens.output },
    { key: "model time", kind: "seconds", a: a.totalLatency, b: b.totalLatency },
    { key: "cost", kind: "cost", a: a.totalCost, b: b.totalCost },
    {
      key: "cached prefix",
      kind: "share",
      a: share(ia.cachedTokens, ia.inputTokens),
      b: share(ib.cachedTokens, ib.inputTokens),
    },
    { key: "tool calls", kind: "count", a: callsA.length, b: callsB.length },
    { key: "tool failures", kind: "count", a: failures(callsA), b: failures(callsB) },
  ];
  if (ia.promptWaitShare !== null && ib.promptWaitShare !== null) {
    metrics.push({
      key: "prompt wait",
      kind: "share",
      a: ia.promptWaitShare,
      b: ib.promptWaitShare,
    });
  }
  // traces without price data report 0; a delta of nothing is noise
  return metrics.filter((m) => m.key !== "cost" || m.a > 0 || m.b > 0);
}

/** The run's system prompt: system messages of the first generation. */
function systemPrompt(trace: NormalizedTrace): string {
  return (trace.generations[0]?.newMessages ?? [])
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join("\n");
}

function comparePrompts(a: string, b: string): PromptDiff {
  if (a === b) {
    return { same: true, aChars: a.length, bChars: b.length, addedLines: 0, removedLines: 0 };
  }
  const lines = diffLines(a.split("\n"), b.split("\n"));
  return {
    same: false,
    aChars: a.length,
    bChars: b.length,
    addedLines: lines?.filter((line) => line.kind === "added").length ?? 0,
    removedLines: lines?.filter((line) => line.kind === "removed").length ?? 0,
    ...(lines !== undefined ? { lines } : {}),
  };
}

/** Tool definitions by name across all events; a redefinition keeps the last one. */
function toolDefs(raw: RawTrace): Map<string, RawToolDef> {
  const defs = new Map<string, RawToolDef>();
  for (const event of raw.events) {
    for (const def of event.available_tools ?? []) defs.set(def.name, def);
  }
  return defs;
}

function compareTools(a: Map<string, RawToolDef>, b: Map<string, RawToolDef>): ToolsDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const name of a.keys()) if (!b.has(name)) removed.push(name);
  for (const [name, def] of b) {
    const other = a.get(name);
    if (other === undefined) added.push(name);
    else if (defKey(other) !== defKey(def)) changed.push(name);
    else unchanged++;
  }
  return { added, removed, changed, unchanged };
}

function defKey(def: RawToolDef): string {
  return JSON.stringify({ description: def.description, inputSchema: def.inputSchema });
}
