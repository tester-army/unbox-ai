import {
  compareTraces,
  metricDelta,
  metricValue,
  type PromptDiff,
  type ToolsDiff,
} from "../../core/compare";
import type { DiffLine } from "../../core/diff";
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
      comparison.metrics.map((m) => [
        m.key,
        metricValue(m.kind, m.a),
        metricValue(m.kind, m.b),
        metricDelta(m),
      ]),
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

function printPromptDiff(diff: PromptDiff): void {
  if (diff.same) {
    console.log(
      diff.aChars === 0
        ? "system prompt  none in either trace"
        : `system prompt  identical (${diff.aChars} chars)`,
    );
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
