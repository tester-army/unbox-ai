import { type DiffLine, diffLines } from "./diff";
import { formatCallNames, formatCost, formatSeconds, formatTokens } from "./format";
import { computeInsights, type Insights } from "./insights";
import { allToolCalls, toolCallNames } from "./normalize";
import type { Generation, NormalizedTrace, RawToolDef, RawTrace } from "./types";

/** One side of a comparison: the normalized trace plus its tool definitions. */
export interface ComparableTrace {
  trace: NormalizedTrace;
  tools: RawToolDef[];
}

export type MetricKind = "count" | "tokens" | "seconds" | "cost" | "share";

export interface ComparedMetric {
  key: string;
  kind: MetricKind;
  a: number;
  b: number;
}

export type PromptDiff =
  | { kind: "identical"; chars: number }
  /** The prompts differ but are too large to line-diff. */
  | { kind: "too-large"; aChars: number; bChars: number }
  | {
      kind: "differs";
      aChars: number;
      bChars: number;
      addedLines: number;
      removedLines: number;
      lines: DiffLine[];
    };

/** One tool whose definition differs between the runs. */
export interface ToolChange {
  name: string;
  /** Which parts of the definition differ. */
  parts: ("description" | "schema")[];
  /** Line diff of the rendered definition; absent when too large to diff. */
  lines?: DiffLine[];
}

export interface ToolsDiff {
  added: string[];
  removed: string[];
  changed: ToolChange[];
  unchanged: number;
}

/** One tool's call activity in both runs. */
export interface ToolUsageDelta {
  name: string;
  a: ToolUsageSide;
  b: ToolUsageSide;
}

export interface ToolUsageSide {
  calls: number;
  failures: number;
  seconds: number;
}

export interface TraceComparison {
  models: { a: string[]; b: string[] };
  metrics: ComparedMetric[];
  /** The runs' first user messages - differing tasks make deltas misleading. */
  task: PromptDiff;
  systemPrompt: PromptDiff;
  tools: ToolsDiff;
  /** Per-tool call activity, biggest call-count change first. */
  toolUsage: ToolUsageDelta[];
}

/** Diffs two traces: headline metric deltas plus task, prompt, and tool changes. */
export function compareTraces(a: ComparableTrace, b: ComparableTrace): TraceComparison {
  return {
    models: { a: a.trace.models, b: b.trace.models },
    metrics: compareMetrics(a.trace, b.trace),
    task: comparePrompts(taskPrompt(a.trace), taskPrompt(b.trace)),
    systemPrompt: comparePrompts(systemPrompt(a.trace), systemPrompt(b.trace)),
    tools: compareTools(a.tools, b.tools),
    toolUsage: compareToolUsage(a.trace, b.trace),
  };
}

/** The task given to the run: its first user message. */
export function taskPrompt(trace: NormalizedTrace): string {
  for (const gen of trace.generations) {
    for (const message of gen.newMessages) {
      if (message.role === "user") return message.text;
    }
  }
  return "";
}

/** What the run concluded: its last assistant message that carries text. */
export function finalText(trace: NormalizedTrace): string {
  for (let i = trace.generations.length - 1; i >= 0; i--) {
    const messages = trace.generations[i]!.newMessages;
    for (let j = messages.length - 1; j >= 0; j--) {
      const message = messages[j]!;
      if (message.role === "assistant" && message.text.trim() !== "") return message.text;
    }
  }
  return "";
}

function compareToolUsage(a: NormalizedTrace, b: NormalizedTrace): ToolUsageDelta[] {
  const usage = (trace: NormalizedTrace) => {
    const byName = new Map<string, ToolUsageSide>();
    for (const call of allToolCalls(trace)) {
      const entry = byName.get(call.name) ?? { calls: 0, failures: 0, seconds: 0 };
      entry.calls++;
      if (call.success === false) entry.failures++;
      entry.seconds += (call.durationMs ?? 0) / 1000;
      byName.set(call.name, entry);
    }
    return byName;
  };
  const [ua, ub] = [usage(a), usage(b)];
  const none: ToolUsageSide = { calls: 0, failures: 0, seconds: 0 };
  const names = [...new Set([...ua.keys(), ...ub.keys()])];
  return names
    .map((name) => ({ name, a: ua.get(name) ?? none, b: ub.get(name) ?? none }))
    .sort(
      (x, y) =>
        Math.abs(y.b.calls - y.a.calls) - Math.abs(x.b.calls - x.a.calls) ||
        y.a.calls + y.b.calls - (x.a.calls + x.b.calls) ||
        x.name.localeCompare(y.name),
    );
}

/** Everything the metric rows read, derived once per side. */
interface SideStats {
  trace: NormalizedTrace;
  insights: Insights;
  calls: ReturnType<typeof allToolCalls>;
  /** ttft-attributed split of model time, summed across segments. */
  time: { wait: number; output: number; unattributed: number };
}

function sideStats(trace: NormalizedTrace): SideStats {
  const insights = computeInsights(trace);
  const time = insights.perSegment.reduce(
    (acc, segment) => ({
      wait: acc.wait + segment.promptWait,
      output: acc.output + segment.generation,
      unattributed: acc.unattributed + segment.unattributed,
    }),
    { wait: 0, output: 0, unattributed: 0 },
  );
  return { trace, insights, calls: allToolCalls(trace), time };
}

/**
 * The metrics table, one row per entry, both sides read through `of`.
 * `optional` rows hide when neither trace reports the data (both 0);
 * an `of` returning null (unreported) drops the row entirely.
 */
const METRIC_ROWS: {
  key: string;
  kind: MetricKind;
  optional?: true;
  of: (side: SideStats) => number | null;
}[] = [
  { key: "generations", kind: "count", of: (s) => s.trace.generations.length },
  { key: "segments", kind: "count", of: (s) => s.trace.segmentCount },
  { key: "input tokens", kind: "tokens", of: (s) => s.trace.totalTokens.input },
  { key: "output tokens", kind: "tokens", of: (s) => s.trace.totalTokens.output },
  {
    key: "reasoning tokens",
    kind: "tokens",
    optional: true,
    of: (s) =>
      s.trace.generations.reduce((sum, gen) => sum + (gen.metrics.reasoningTokens ?? 0), 0),
  },
  { key: "model time", kind: "seconds", of: (s) => s.trace.totalLatency },
  // ttft-attributed split of model time: waiting for the first token vs
  // producing tokens (thinking included - traces carry no finer split)
  { key: "prompt wait time", kind: "seconds", optional: true, of: (s) => s.time.wait },
  { key: "output time", kind: "seconds", optional: true, of: (s) => s.time.output },
  // generations that report no ttft (reasoning models often don't) land
  // here - this is where hidden thinking time shows up
  { key: "unattributed time", kind: "seconds", optional: true, of: (s) => s.time.unattributed },
  {
    key: "tool time",
    kind: "seconds",
    optional: true,
    of: (s) => s.calls.reduce((ms, call) => ms + (call.durationMs ?? 0), 0) / 1000,
  },
  { key: "cost", kind: "cost", optional: true, of: (s) => s.trace.totalCost },
  {
    key: "cached prefix",
    kind: "share",
    of: (s) => (s.insights.inputTokens > 0 ? s.insights.cachedTokens / s.insights.inputTokens : 0),
  },
  { key: "tool calls", kind: "count", of: (s) => s.calls.length },
  {
    key: "tool failures",
    kind: "count",
    of: (s) => s.calls.filter((call) => call.success === false).length,
  },
  { key: "prompt wait", kind: "share", of: (s) => s.insights.promptWaitShare },
];

function compareMetrics(a: NormalizedTrace, b: NormalizedTrace): ComparedMetric[] {
  const [sa, sb] = [sideStats(a), sideStats(b)];
  return METRIC_ROWS.flatMap((row) => {
    const [va, vb] = [row.of(sa), row.of(sb)];
    if (va === null || vb === null) return [];
    if (row.optional && va <= 0 && vb <= 0) return [];
    return [{ key: row.key, kind: row.kind, a: va, b: vb }];
  });
}

/** The run's system prompt: system messages of the first generation. */
export function systemPrompt(trace: NormalizedTrace): string {
  return (trace.generations[0]?.newMessages ?? [])
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join("\n");
}

function comparePrompts(a: string, b: string): PromptDiff {
  if (a === b) return { kind: "identical", chars: a.length };
  const lines = diffLines(a.split("\n"), b.split("\n"));
  if (lines === undefined) return { kind: "too-large", aChars: a.length, bChars: b.length };
  return {
    kind: "differs",
    aChars: a.length,
    bChars: b.length,
    addedLines: lines.filter((line) => line.kind === "added").length,
    removedLines: lines.filter((line) => line.kind === "removed").length,
    lines,
  };
}

/** Tool definitions across all events, deduped by name; a redefinition keeps the last one. */
export function collectToolDefs(raw: RawTrace): RawToolDef[] {
  const defs = new Map<string, RawToolDef>();
  for (const event of raw.events) {
    for (const def of event.available_tools ?? []) defs.set(def.name, def);
  }
  return [...defs.values()];
}

function compareTools(defsA: RawToolDef[], defsB: RawToolDef[]): ToolsDiff {
  const byName = (defs: RawToolDef[]) => new Map(defs.map((def) => [def.name, def]));
  const a = byName(defsA);
  const b = byName(defsB);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ToolChange[] = [];
  let unchanged = 0;
  for (const name of a.keys()) if (!b.has(name)) removed.push(name);
  for (const [name, def] of b) {
    const other = a.get(name);
    if (other === undefined) {
      added.push(name);
      continue;
    }
    const change = toolChange(other, def);
    if (change !== undefined) changed.push(change);
    else unchanged++;
  }
  return { added, removed, changed, unchanged };
}

/** What changed in a redefined tool, or undefined when the definitions match. */
function toolChange(a: RawToolDef, b: RawToolDef): ToolChange | undefined {
  const parts: ToolChange["parts"] = [];
  if (a.description !== b.description) parts.push("description");
  if (JSON.stringify(a.inputSchema) !== JSON.stringify(b.inputSchema)) parts.push("schema");
  if (parts.length === 0) return undefined;
  const lines = diffLines(defLines(a), defLines(b));
  return { name: b.name, parts, ...(lines !== undefined ? { lines } : {}) };
}

/** The two diffable parts of a tool definition; absent parts render empty. */
export function toolDefParts(def: RawToolDef): { description: string; schema: string } {
  return {
    description: def.description ?? "",
    schema: def.inputSchema !== undefined ? JSON.stringify(def.inputSchema, null, 2) : "",
  };
}

/** A definition as diffable lines: the description text, then the pretty schema. */
function defLines(def: RawToolDef): string[] {
  const parts = toolDefParts(def);
  const lines = parts.description !== "" ? parts.description.split("\n") : [];
  if (parts.schema !== "") lines.push(...parts.schema.split("\n"));
  return lines;
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

/** True when the runs differ at this step: a diverged pair or a one-sided row. */
export function stepDiffers(step: TrajectoryStep): boolean {
  return step.diverged || step.a === undefined || step.b === undefined;
}

/** "12" when both sides sit at the same generation, else "a12/b13" style. */
export function stepIndexLabel(step: TrajectoryStep): string {
  if (step.a !== undefined && step.b !== undefined) {
    return step.a.index === step.b.index
      ? String(step.a.index)
      : `a${step.a.index}/b${step.b.index}`;
  }
  return step.a !== undefined ? `a${step.a.index}` : `b${step.b!.index}`;
}

/** One line of what a generation did: its tool calls, or the reply clipped to maxChars. */
export function stepAction(gen: Generation, maxChars: number): string {
  const calls = formatCallNames(toolCallNames(gen));
  return calls !== "" ? calls : `-> ${(gen.newMessages.at(-1)?.text ?? "").slice(0, maxChars)}`;
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
