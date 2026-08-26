import {
  collectToolDefs,
  compareTraces,
  metricDelta,
  metricValue,
  type PromptDiff,
  pairTrajectory,
  stepAction,
  stepDiffers,
  stepIndexLabel,
  type ToolChange,
  type ToolsDiff,
  type ToolUsageDelta,
  type TrajectoryStep,
} from "../../core/compare";
import type { DiffLine } from "../../core/diff";
import { formatSeconds, formatTokens } from "../../core/format";
import { toolCallNames } from "../../core/normalize";
import type { Generation } from "../../core/types";
import type { LoadedTrace } from "../load";
import { printJson, table } from "../output";

/** Bounded plain output; --json carries the full diff. */
const MAX_DIFF_LINES = 40;
const MAX_LINE_CHARS = 160;
const MAX_NAMES = 8;
const MAX_CHANGED_TOOLS = 20;

/** Prints metric deltas and config differences between two loaded traces. */
export function compare(
  a: LoadedTrace,
  b: LoadedTrace,
  labels: { a: string; b: string },
  options: { json: boolean; trajectory: boolean },
): void {
  const comparable = (loaded: LoadedTrace) => ({
    trace: loaded.trace,
    tools: collectToolDefs(loaded.raw),
  });
  const comparison = compareTraces(comparable(a), comparable(b));
  const steps = pairTrajectory(a.trace, b.trace);
  if (options.json) {
    printJson({
      a: side(a, labels.a),
      b: side(b, labels.b),
      ...comparison,
      trajectory: steps.map((step) => ({
        diverged: step.diverged,
        a: stepJson(step.a),
        b: stepJson(step.b),
      })),
    });
    return;
  }
  console.log(`A  ${a.trace.name}  (${labels.a})`);
  console.log(`B  ${b.trace.name}  (${labels.b})`);
  const { models } = comparison;
  console.log(
    models.a.join(", ") === models.b.join(", ")
      ? `models  ${models.a.join(", ")}`
      : `models  A: ${models.a.join(", ")}  B: ${models.b.join(", ")}`,
  );
  printPromptDiff("task", comparison.task);
  console.log("");
  console.log(
    table(
      ["metric", "A", "B", "delta"],
      comparison.metrics.map((m) => [
        m.key,
        metricValue(m.kind, m.a),
        metricValue(m.kind, m.b),
        metricDelta(m),
      ]),
    ),
  );
  console.log("");
  printPromptDiff("system prompt", comparison.systemPrompt);
  printToolsDiff(comparison.tools);
  printToolUsage(comparison.toolUsage);
  if (options.trajectory) {
    console.log("");
    printTrajectory(steps);
  } else {
    const different = steps.filter(stepDiffers);
    if (different.length > 0) {
      const at = different[0]!;
      console.log(
        `\ntrajectories differ at ${different.length} of ${steps.length} steps ` +
          `(first at generation ${(at.a ?? at.b)!.index}) - see: --trajectory`,
      );
    }
  }
}

function stepJson(gen: Generation | undefined) {
  if (gen === undefined) return null;
  return {
    index: gen.index,
    tools: toolCallNames(gen),
    inputTokens: gen.metrics.inputTokens,
    outputTokens: gen.metrics.outputTokens,
    latency: gen.metrics.latency,
  };
}

/** Content-aligned per-generation actions; "*" marks steps where the runs differ. */
function printTrajectory(steps: TrajectoryStep[]): void {
  console.log("trajectory (aligned by action · * = differs · - = no counterpart)");
  console.log(
    table(
      ["gen", "", "A", "B"],
      steps.map((step) => [
        stepIndexLabel(step),
        stepDiffers(step) ? "*" : "",
        actionCell(step.a),
        actionCell(step.b),
      ]),
    ),
  );
}

function actionCell(gen: Generation | undefined): string {
  if (gen === undefined) return "-";
  return `${stepAction(gen, 32)}  ${formatTokens(gen.metrics.inputTokens)} in ${formatSeconds(gen.metrics.latency)}`;
}

function side(loaded: LoadedTrace, label: string) {
  return {
    traceId: loaded.trace.traceId,
    name: loaded.trace.name,
    source: label,
    format: loaded.format,
  };
}

function printPromptDiff(label: string, diff: PromptDiff): void {
  const tag = label.padEnd(15);
  if (diff.kind === "identical") {
    console.log(
      diff.chars === 0 ? `${tag}none in either trace` : `${tag}identical (${diff.chars} chars)`,
    );
    return;
  }
  if (diff.kind === "too-large") {
    console.log(
      `${tag}differs (A ${diff.aChars} chars, B ${diff.bChars} chars - too large to line-diff, see --json)`,
    );
    return;
  }
  console.log(`${tag}differs: +${diff.addedLines} / -${diff.removedLines} lines`);
  const printable = hunks(diff.lines);
  for (const line of printable.slice(0, MAX_DIFF_LINES)) console.log(`  ${line}`);
  if (printable.length > MAX_DIFF_LINES) {
    console.log(`  [... ${printable.length - MAX_DIFF_LINES} more diff lines - full diff: --json]`);
  }
}

/** Changed lines with one context line around each run; "~" marks skipped stretches. */
function hunks(lines: DiffLine[]): string[] {
  const out: string[] = [];
  const changed = (line?: DiffLine) => line !== undefined && line.kind !== "same";
  const clip = (text: string) =>
    text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}...` : text;
  lines.forEach((line, i) => {
    if (changed(line)) {
      out.push(`${line.kind === "added" ? "+" : "-"} ${clip(line.text)}`);
    } else if (changed(lines[i - 1]) || changed(lines[i + 1])) {
      out.push(`  ${clip(line.text)}`);
    } else if (out.at(-1) !== "~") {
      out.push("~");
    }
  });
  while (out[0] === "~") out.shift();
  while (out.at(-1) === "~") out.pop();
  return out;
}

function printToolsDiff(tools: ToolsDiff): void {
  const total = tools.unchanged + tools.changed.length + tools.added.length + tools.removed.length;
  if (total === 0) {
    console.log("tools          none in either trace");
    return;
  }
  const names = (list: string[]) =>
    list.length > MAX_NAMES ? `${list.slice(0, MAX_NAMES).join(", ")}, ...` : list.join(", ");
  const parts: string[] = [];
  if (tools.added.length > 0) parts.push(`+${tools.added.length} added (${names(tools.added)})`);
  if (tools.removed.length > 0) {
    parts.push(`-${tools.removed.length} removed (${names(tools.removed)})`);
  }
  if (tools.changed.length > 0) parts.push(`${tools.changed.length} changed`);
  parts.push(`${tools.unchanged} unchanged`);
  console.log(`tools          ${parts.join(" · ")}`);
  if (tools.changed.length === 0) return;
  console.log("changed tools (definition diffs: --json):");
  const width = Math.max(...tools.changed.map((change) => change.name.length));
  for (const change of tools.changed.slice(0, MAX_CHANGED_TOOLS)) {
    console.log(`  ~ ${change.name.padEnd(width)}  ${changeSummary(change)}`);
  }
  if (tools.changed.length > MAX_CHANGED_TOOLS) {
    console.log(`  [... ${tools.changed.length - MAX_CHANGED_TOOLS} more]`);
  }
}

/** Per-tool call activity where the runs differ; identical rows just count. */
function printToolUsage(usage: ToolUsageDelta[]): void {
  const changed = usage.filter((u) => u.a.calls !== u.b.calls || u.a.failures !== u.b.failures);
  if (changed.length === 0) return;
  const same = usage.length - changed.length;
  console.log(`\ntool usage (biggest change first${same > 0 ? ` · ${same} tools unchanged` : ""})`);
  const pair = (a: number, b: number, render: (v: number) => string) =>
    a === 0 && b === 0 ? "" : `${render(a)} -> ${render(b)}`;
  console.log(
    table(
      ["tool", "A", "B", "delta", "failures", "time"],
      changed
        .slice(0, MAX_CHANGED_TOOLS)
        .map((u) => [
          u.name,
          String(u.a.calls),
          String(u.b.calls),
          metricDelta({ key: u.name, kind: "count", a: u.a.calls, b: u.b.calls }),
          pair(u.a.failures, u.b.failures, String),
          pair(u.a.seconds, u.b.seconds, formatSeconds),
        ]),
    ),
  );
  if (changed.length > MAX_CHANGED_TOOLS) {
    console.log(`  [... ${changed.length - MAX_CHANGED_TOOLS} more - see --json]`);
  }
}

/** "description + schema · +3/-1 lines" style. */
function changeSummary(change: ToolChange): string {
  if (change.lines === undefined) return `${change.parts.join(" + ")} · too large to line-diff`;
  const added = change.lines.filter((line) => line.kind === "added").length;
  const removed = change.lines.filter((line) => line.kind === "removed").length;
  return `${change.parts.join(" + ")} · +${added}/-${removed} lines`;
}
