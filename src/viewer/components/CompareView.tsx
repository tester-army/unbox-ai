import type { RunSummary } from "@core/collection";
import {
  type ComparableTrace,
  type ComparedMetric,
  compareTraces,
  metricDelta,
  metricValue,
  pairTrajectory,
  type TraceComparison,
  type TrajectoryStep,
} from "@core/compare";
import { formatCallNames, formatSeconds, formatTokens } from "@core/format";
import { toolCallNames } from "@core/normalize";
import type { Generation, NormalizedTrace, RawTrace } from "@core/types";
import { useEffect, useMemo, useState } from "react";
import { MessageCard } from "@/components/MessageCard";
import { Button } from "@/components/ui/button";
import { localTraceItem } from "@/lib/use-trace";
import { cn } from "@/lib/utils";

interface CompareViewProps {
  runs: RunSummary[];
  /** Run preselected as side A, normally the one on screen. */
  initialA: string;
  onClose: () => void;
}

/**
 * Full-pane A/B exploration: aligned per-generation trajectory with
 * expandable message detail, headline deltas, prompt and tool diffs.
 */
export function CompareView({ runs, initialA, onClose }: CompareViewProps) {
  const [aId, setAId] = useState(initialA);
  const [bId, setBId] = useState(
    () => (runs.find((run) => run.id !== initialA) ?? runs[0])?.id ?? initialA,
  );
  const [sides, setSides] = useState<{ a: ComparableTrace; b: ComparableTrace }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stale = false;
    setSides(undefined);
    setError(undefined);
    Promise.all([loadSide(aId), loadSide(bId)])
      .then(([a, b]) => {
        if (!stale) setSides({ a, b });
      })
      .catch((cause) => {
        if (!stale) setError(String(cause));
      });
    return () => {
      stale = true;
    };
  }, [aId, bId]);

  const comparison = useMemo(
    () => (sides !== undefined ? compareTraces(sides.a, sides.b) : undefined),
    [sides],
  );
  const steps = useMemo(
    () => (sides !== undefined ? pairTrajectory(sides.a.trace, sides.b.trace) : undefined),
    [sides],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-ta-grey-400 px-6 py-3">
        <RunSelect side="A" runs={runs} value={aId} onChange={setAId} />
        <span className="type-accent-s shrink-0 text-ta-grey-300">vs</span>
        <RunSelect side="B" runs={runs} value={bId} onChange={setBId} />
        <Button className="shrink-0" onClick={onClose}>
          close
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
        {error && <p className="type-body-s text-ta-error">Failed to compare: {error}</p>}
        {!error && comparison === undefined && (
          <p className="type-accent-s text-ta-grey-200">loading runs...</p>
        )}
        {comparison && steps && (
          <>
            <MetricsGrid comparison={comparison} />
            <Trajectory steps={steps} />
            <PromptSection prompt={comparison.systemPrompt} />
            <ToolsSection tools={comparison.tools} />
          </>
        )}
      </div>
    </div>
  );
}

function RunSelect({
  side,
  runs,
  value,
  onChange,
}: {
  side: string;
  runs: RunSummary[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="type-accent-s flex min-w-0 flex-1 items-center gap-2 text-ta-grey-200">
      {side}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer border border-ta-grey-400 bg-ta-grey-450 px-2 py-1.5 text-ta-sand-50"
      >
        {runs.map((run) => (
          <option key={run.id} value={run.id}>
            {runLabel(run)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "file.json · run name" so cross-file picks stay legible. */
function runLabel(run: RunSummary): string {
  const base = run.source?.split(/[\\/]/).filter(Boolean).at(-1);
  return base !== undefined ? `${base} · ${run.name}` : run.name;
}

function MetricsGrid({ comparison }: { comparison: TraceComparison }) {
  const { models, metrics } = comparison;
  const sameModels = models.a.join(", ") === models.b.join(", ");
  return (
    <Section
      label={
        sameModels
          ? `totals · ${models.a.join(", ")}`
          : `totals · A: ${models.a.join(", ")} · B: ${models.b.join(", ")}`
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {metrics.map((m) => (
          <MetricTile key={m.key} metric={m} />
        ))}
      </div>
    </Section>
  );
}

/** One headline metric as a stat tile: name, prominent delta, A/B bars and values. */
function MetricTile({ metric }: { metric: ComparedMetric }) {
  const delta = metricDelta(metric);
  return (
    <div className="flex flex-col gap-2.5 border border-ta-grey-400 bg-ta-grey-450/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-accent-s text-ta-grey-200">{metric.key}</span>
        <span
          className={cn("type-accent-m", delta === "=" ? "text-ta-grey-300" : "text-ta-sand-50")}
        >
          {delta}
        </span>
      </div>
      <MetricBars metric={metric} />
      <div className="type-accent-s flex justify-between gap-3 text-ta-grey-100">
        <span>
          <SeriesChip className="bg-ta-grey-300" /> A {metricValue(metric.kind, metric.a)}
        </span>
        <span>
          <SeriesChip className="bg-ta-orange-300" /> B {metricValue(metric.kind, metric.b)}
        </span>
      </div>
    </div>
  );
}

/** Ties a bar's series color to its value column. */
function SeriesChip({ className }: { className: string }) {
  return <span aria-hidden className={cn("mr-1 inline-block size-1.5 align-middle", className)} />;
}

/**
 * Paired A/B bars per metric. Each row scales to its own max - tokens,
 * dollars, and seconds share no axis - except shares, which scale to 100%
 * so the bar length is the honest ratio. A is the neutral reference, B the
 * accent; identity is also carried by position and the labeled columns.
 */
function MetricBars({ metric }: { metric: ComparedMetric }) {
  const scale = metric.kind === "share" ? 1 : Math.max(metric.a, metric.b);
  const width = (v: number) => (scale <= 0 || v <= 0 ? "0%" : `${Math.max((v / scale) * 100, 2)}%`);
  return (
    <div
      className="flex min-w-16 flex-col gap-0.5"
      title={`A ${metricValue(metric.kind, metric.a)} · B ${metricValue(metric.kind, metric.b)}`}
    >
      <Bar className="bg-ta-grey-300" width={width(metric.a)} />
      <Bar className="bg-ta-orange-300" width={width(metric.b)} />
    </div>
  );
}

function Bar({ className, width }: { className: string; width: string }) {
  return (
    <div className="h-[5px] w-full bg-ta-grey-450">
      <div className={cn("h-full", className)} style={{ width }} />
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[4.5rem_1fr_1fr] gap-x-4";

function Trajectory({ steps }: { steps: TrajectoryStep[] }) {
  const [expanded, setExpanded] = useState<number>();
  const different = steps.filter(
    (step) => step.diverged || step.a === undefined || step.b === undefined,
  );
  return (
    <Section
      label={
        different.length === 0
          ? "trajectory · aligned by action · same actions throughout"
          : `trajectory · aligned by action · differs at ${different.length} of ${steps.length} steps`
      }
    >
      <div className="border border-ta-grey-400">
        <div
          className={cn(
            ROW_GRID,
            "type-accent-s border-b border-ta-grey-400 px-4 py-2 text-ta-grey-300",
          )}
        >
          <span>gen</span>
          <span>A</span>
          <span>B</span>
        </div>
        {steps.map((step, row) => {
          const differs = step.diverged || step.a === undefined || step.b === undefined;
          return (
            <div
              key={`${step.a?.index ?? "-"}:${step.b?.index ?? "-"}`}
              className="border-b border-ta-grey-400 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === row ? undefined : row)}
                aria-expanded={expanded === row}
                className={cn(
                  ROW_GRID,
                  "type-accent-s w-full cursor-pointer px-4 py-2 text-left transition-colors hover:bg-ta-grey-450",
                  expanded === row && "bg-ta-grey-450",
                )}
              >
                <span className={differs ? "text-ta-orange-300" : "text-ta-grey-300"}>
                  {stepIndexLabel(step)}
                  {differs && " *"}
                </span>
                <GenCell gen={step.a} diverged={step.diverged} />
                <GenCell gen={step.b} diverged={step.diverged} />
              </button>
              {expanded === row && (
                <div
                  className={cn(
                    ROW_GRID,
                    "border-t border-ta-grey-400 bg-ta-grey-450/40 px-4 py-3",
                  )}
                >
                  <span />
                  <GenDetail gen={step.a} />
                  <GenDetail gen={step.b} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** "12" when both sides sit at the same generation, else "a12/b13" style. */
function stepIndexLabel(step: TrajectoryStep): string {
  if (step.a !== undefined && step.b !== undefined) {
    return step.a.index === step.b.index
      ? String(step.a.index)
      : `a${step.a.index}/b${step.b.index}`;
  }
  return step.a !== undefined ? `a${step.a.index}` : `b${step.b!.index}`;
}

function GenCell({ gen, diverged }: { gen?: Generation; diverged: boolean }) {
  if (gen === undefined) return <span className="text-ta-grey-300">-</span>;
  const calls = formatCallNames(toolCallNames(gen));
  const doing = calls !== "" ? calls : `-> ${(gen.newMessages.at(-1)?.text ?? "").slice(0, 80)}`;
  return (
    <span className="flex min-w-0 items-baseline gap-3">
      <span className={cn("min-w-0 truncate", diverged ? "text-ta-orange-75" : "text-ta-grey-100")}>
        {doing}
      </span>
      <span className="ml-auto shrink-0 text-ta-grey-300">
        {formatTokens(gen.metrics.inputTokens)} in · {formatSeconds(gen.metrics.latency)}
      </span>
    </span>
  );
}

/** One side's new messages for the expanded generation. */
function GenDetail({ gen }: { gen?: Generation }) {
  if (gen === undefined) {
    return <p className="type-accent-s text-ta-grey-300">no generation on this side</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {gen.newMessages.map((message) => (
        <MessageCard key={message.index} message={message} />
      ))}
      {gen.newMessages.length === 0 && (
        <p className="type-accent-s text-ta-grey-300">no new messages</p>
      )}
    </div>
  );
}

/** Full diff is rendered; the pane scrolls. */
const MAX_RENDERED_DIFF_LINES = 600;

function PromptSection({ prompt }: { prompt: TraceComparison["systemPrompt"] }) {
  if (prompt.same) {
    return (
      <Section label="system prompt">
        <p className="type-body-s text-ta-grey-200">
          {prompt.aChars === 0 ? "none in either run" : `identical (${prompt.aChars} chars)`}
        </p>
      </Section>
    );
  }
  if (prompt.lines === undefined) {
    return (
      <Section label="system prompt">
        <p className="type-body-s text-ta-grey-200">
          differs (A {prompt.aChars} chars, B {prompt.bChars} chars - too large to line-diff)
        </p>
      </Section>
    );
  }
  const lines = prompt.lines.slice(0, MAX_RENDERED_DIFF_LINES);
  return (
    <Section label={`system prompt · +${prompt.addedLines} / -${prompt.removedLines} lines`}>
      <div className="type-body-s overflow-x-auto whitespace-pre border border-ta-grey-400 bg-ta-grey-450 px-3 py-2 font-(family-name:--font-dm-mono) leading-relaxed">
        {lines.map((line, i) => (
          <div
            // diff lines have no identity beyond their position
            // biome-ignore lint/suspicious/noArrayIndexKey: positional list
            key={i}
            className={cn(
              line.kind === "added" && "bg-ta-orange-300/10 text-ta-orange-75",
              line.kind === "removed" && "bg-ta-error/10 text-ta-error",
              line.kind === "same" && "text-ta-grey-200",
            )}
          >
            {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
            {line.text}
          </div>
        ))}
        {prompt.lines.length > lines.length && (
          <div className="text-ta-grey-300">
            [... {prompt.lines.length - lines.length} more lines]
          </div>
        )}
      </div>
    </Section>
  );
}

function ToolsSection({ tools }: { tools: TraceComparison["tools"] }) {
  const total = tools.unchanged + tools.changed.length + tools.added.length + tools.removed.length;
  return (
    <Section label="tools">
      {total === 0 ? (
        <p className="type-body-s text-ta-grey-200">none in either run</p>
      ) : (
        <div className="type-body-s flex flex-col gap-1">
          {tools.added.length > 0 && (
            <p className="text-ta-orange-75">+ added: {tools.added.join(", ")}</p>
          )}
          {tools.removed.length > 0 && (
            <p className="text-ta-error">- removed: {tools.removed.join(", ")}</p>
          )}
          {tools.changed.length > 0 && (
            <p className="text-ta-sand-50">changed: {tools.changed.join(", ")}</p>
          )}
          <p className="text-ta-grey-200">{tools.unchanged} unchanged</p>
        </div>
      )}
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-accent-s text-ta-grey-200">{label}</p>
      {children}
    </div>
  );
}

/** A run's trace + raw, from local memory for browser-opened files, else the server. */
async function loadSide(id: string): Promise<ComparableTrace> {
  const local = localTraceItem(id);
  if (local !== undefined) return local;
  const [trace, raw] = await Promise.all([
    fetchJson(`/api/trace?id=${encodeURIComponent(id)}`) as Promise<NormalizedTrace>,
    (fetchJson(`/api/raw?id=${encodeURIComponent(id)}&path=`) as Promise<{ value: RawTrace }>).then(
      (body) => body.value,
    ),
  ]);
  return { trace, raw };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
  return res.json();
}
