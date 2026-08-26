import {
  type ComparedMetric,
  compareTraces,
  type PromptDiff,
  type ToolsDiff,
} from "../../core/compare";
import type { DiffLine } from "../../core/diff";
import { formatCost, formatSeconds, formatTokens } from "../../core/format";
import type { LoadedTrace } from "../load";
import { printJson, table } from "../output";

/** Bounded plain output; --json carries the full diff. */
const MAX_DIFF_LINES = 40;
const MAX_LINE_CHARS = 160;
const MAX_NAMES = 8;

/** Prints metric deltas and config differences between two loaded traces. */
export function compare(
  a: LoadedTrace,
  b: LoadedTrace,
  labels: { a: string; b: string },
  json: boolean,
): void {
  const comparison = compareTraces(a, b);
  if (json) {
    printJson({ a: side(a, labels.a), b: side(b, labels.b), ...comparison });
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
  console.log("");
  console.log(
    table(
      ["metric", "A", "B", "delta"],
      comparison.metrics.map((m) => [m.key, value(m, m.a), value(m, m.b), delta(m)]),
    ),
  );
  console.log("");
  printPromptDiff(comparison.systemPrompt);
  printToolsDiff(comparison.tools);
}

function side(loaded: LoadedTrace, label: string) {
  return {
    traceId: loaded.trace.traceId,
    name: loaded.trace.name,
    source: label,
    format: loaded.format,
  };
}

function value(metric: ComparedMetric, v: number): string {
  switch (metric.kind) {
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
function delta(metric: ComparedMetric): string {
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

function printPromptDiff(diff: PromptDiff): void {
  if (diff.same) {
    console.log(`system prompt  identical (${diff.aChars} chars)`);
    return;
  }
  if (diff.lines === undefined) {
    console.log(
      `system prompt  differs (A ${diff.aChars} chars, B ${diff.bChars} chars - too large to line-diff, see --json)`,
    );
    return;
  }
  console.log(`system prompt  differs: +${diff.addedLines} / -${diff.removedLines} lines`);
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
  if (tools.changed.length > 0) {
    parts.push(`${tools.changed.length} changed (${names(tools.changed)})`);
  }
  parts.push(`${tools.unchanged} unchanged`);
  console.log(`tools          ${parts.join(" · ")}`);
}
