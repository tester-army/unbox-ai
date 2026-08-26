import { type DiffLine, diffLines } from "./diff";
import { formatCost, formatSeconds, formatTokens } from "./format";
import { computeInsights } from "./insights";
import { allToolCalls, toolCallNames } from "./normalize";
import type { Generation, NormalizedTrace, RawToolDef, RawTrace } from "./types";

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

export interface TrajectoryStep {
  a?: Generation;
  b?: Generation;
  /** Both sides exist and took a different action (tool sequence or text-only). */
  diverged: boolean;
}

/**
 * Aligns the runs' generations by action content (LCS over tool sequences),
 * so an extra step in one run offsets nothing: matched steps pair up, and
 * insertions show as one-sided rows. Runs of mismatches are zipped into
 * diverged pairs. Falls back to index alignment on pathologically long runs.
 */
export function pairTrajectory(a: NormalizedTrace, b: NormalizedTrace): TrajectoryStep[] {
  const diff = diffLines(a.generations.map(actionKey), b.generations.map(actionKey));
  if (diff === undefined) return pairByIndex(a, b);
  const steps: TrajectoryStep[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < diff.length) {
    if (diff[k]!.kind === "same") {
      steps.push({ a: a.generations[i++]!, b: b.generations[j++]!, diverged: false });
      k++;
      continue;
    }
    const removed: Generation[] = [];
    const added: Generation[] = [];
    for (; k < diff.length && diff[k]!.kind !== "same"; k++) {
      if (diff[k]!.kind === "removed") removed.push(a.generations[i++]!);
      else added.push(b.generations[j++]!);
    }
    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      steps.push({
        ...(removed[r] !== undefined ? { a: removed[r] } : {}),
        ...(added[r] !== undefined ? { b: added[r] } : {}),
        diverged: removed[r] !== undefined && added[r] !== undefined,
      });
    }
  }
  return steps;
}

function pairByIndex(a: NormalizedTrace, b: NormalizedTrace): TrajectoryStep[] {
  const length = Math.max(a.generations.length, b.generations.length);
  return Array.from({ length }, (_, index) => {
    const genA = a.generations[index];
    const genB = b.generations[index];
    return {
      ...(genA !== undefined ? { a: genA } : {}),
      ...(genB !== undefined ? { b: genB } : {}),
      diverged: genA !== undefined && genB !== undefined && actionKey(genA) !== actionKey(genB),
    };
  });
}

/** What a generation did: its tool calls in order, or a plain text response. */
export function actionKey(gen: Generation): string {
  const tools = toolCallNames(gen);
  return tools.length > 0 ? tools.join(",") : "text";
}

/** One metric value rendered for its kind, shared by the CLI table and the viewer. */
export function metricValue(kind: MetricKind, v: number): string {
  switch (kind) {
    case "count":
      return String(v);
    case "tokens":
      return formatTokens(v);
    case "seconds":
      return formatSeconds(v);
    case "cost":
      return formatCost(v);
    case "share":
      return `${Math.round(v * 100)}%`;
  }
}

/** "-3 (-25%)" style delta, "pp" for share metrics, "=" when equal. */
export function metricDelta(metric: ComparedMetric): string {
  const d = metric.b - metric.a;
  if (d === 0) return "=";
  const sign = d > 0 ? "+" : "-";
  const abs = Math.abs(d);
  if (metric.kind === "share") {
    const points = Math.round(abs * 100);
    return points === 0 ? "=" : `${sign}${points}pp`;
  }
  const text = {
    count: String(abs),
    tokens: formatTokens(abs),
    seconds: formatSeconds(abs),
    cost: `$${abs.toFixed(4)}`,
  }[metric.kind];
  const relative = metric.a > 0 ? ` (${sign}${Math.round((abs / metric.a) * 100)}%)` : "";
  return `${sign}${text}${relative}`;
}
