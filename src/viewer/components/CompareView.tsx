import type { RunSummary } from "@core/collection";
import {
  type ComparableTrace,
  type ComparedMetric,
  collectToolDefs,
  compareTraces,
  metricDelta,
  metricValue,
  type PromptDiff,
  pairTrajectory,
  stepAction,
  stepDiffers,
  stepIndexLabel,
  type TraceComparison,
  type TrajectoryStep,
} from "@core/compare";
import { formatSeconds, formatTokens } from "@core/format";
import type { Generation, NormalizedTrace, RawToolDef } from "@core/types";
import { useEffect, useMemo, useState } from "react";
import { MessageCard } from "@/components/MessageCard";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";
import { localTraceItem } from "@/lib/local-traces";
import { basename, cn } from "@/lib/utils";

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

  const labels = { a: shortLabel(runs, aId), b: shortLabel(runs, bId) };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-ta-grey-400 px-6 py-3">
        <RunSelect side="A" runs={runs} value={aId} onChange={setAId} />
        <Button
          className="shrink-0"
          title="swap sides"
          onClick={() => {
            setAId(bId);
            setBId(aId);
          }}
        >
          swap
        </Button>
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
            <MetricsGrid comparison={comparison} labels={labels} />
            <Trajectory steps={steps} labels={labels} />
            <PromptSection prompt={comparison.systemPrompt} />
            <ToolsSection tools={comparison.tools} />
          </>
        )}
      </div>
    </div>
  );
}

/** A short, human name for a side: file basename without the trace suffix. */
function shortLabel(runs: RunSummary[], id: string): string {
  const run = runs.find((r) => r.id === id);
  const base =
    run?.source !== undefined
      ? basename(run.source).replace(/\.trace\.json$|\.json$/, "")
      : undefined;
  const label = base ?? run?.name ?? id;
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
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
  return run.source !== undefined ? `${basename(run.source)} · ${run.name}` : run.name;
}

interface SideLabels {
  a: string;
  b: string;
}

function MetricsGrid({ comparison, labels }: { comparison: TraceComparison; labels: SideLabels }) {
  const { models, metrics } = comparison;
  const sameModels = models.a.join(", ") === models.b.join(", ");
  return (
    <Section
      label={
        sameModels
          ? `totals · ${models.a.join(", ")}`
          : `totals · ${labels.a}: ${models.a.join(", ")} · ${labels.b}: ${models.b.join(", ")}`
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {metrics.map((m) => (
          <MetricTile key={m.key} metric={m} labels={labels} />
        ))}
      </div>
    </Section>
  );
}

/**
 * One metric per tile, the change as the hero: a big percent with an arrow,
 * "from -> to" under it, and a small per-tile pair of bars for proportion.
 * Unchanged metrics dim so the moved ones carry the panel.
 */
function MetricTile({ metric, labels }: { metric: ComparedMetric; labels: SideLabels }) {
  const delta = metricDelta(metric);
  const equal = delta === "=";
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 border border-ta-grey-400 bg-ta-grey-450/40 px-4 py-3",
        equal && "opacity-55",
      )}
      title={`${metric.key}: ${delta}`}
    >
      <span className="type-accent-s text-ta-grey-200">{metric.key}</span>
      <span className="font-(family-name:--font-dm-mono) text-2xl leading-none tracking-wide text-ta-sand-50">
        {equal ? (
          <span className="text-ta-grey-300">=</span>
        ) : (
          <>
            <span aria-hidden className="text-ta-orange-300">
              {metric.b > metric.a ? "▲" : "▼"}
            </span>{" "}
            {heroDelta(metric)}
          </>
        )}
      </span>
      <span className="type-accent-s text-ta-grey-200">
        {metricValue(metric.kind, metric.a)} <span className="text-ta-grey-300">-&gt;</span>{" "}
        {metricValue(metric.kind, metric.b)}
      </span>
      <PairBars metric={metric} labels={labels} />
    </div>
  );
}

/** The tile's headline: relative change when A gives a base, else absolute. */
function heroDelta(metric: ComparedMetric): string {
  const abs = Math.abs(metric.b - metric.a);
  if (metric.kind === "share") return `${Math.round(abs * 100)}pp`;
  if (metric.a > 0) {
    const percent = Math.round((abs / metric.a) * 100);
    return percent === 0 ? "<1%" : `${percent}%`;
  }
  return metricValue(metric.kind, abs);
}

/** Both runs' magnitudes on the tile's own scale; shares scale to 100%. */
function PairBars({ metric, labels }: { metric: ComparedMetric; labels: SideLabels }) {
  const scale = metric.kind === "share" ? 1 : Math.max(metric.a, metric.b);
  const width = (v: number) => (scale <= 0 || v <= 0 ? 0 : Math.max((v / scale) * 100, 1.5));
  return (
    <div className="flex flex-col gap-1">
      <PairBar label={labels.a} color="bg-ta-grey-300" width={width(metric.a)} />
      <PairBar label={labels.b} color="bg-ta-orange-300" width={width(metric.b)} />
    </div>
  );
}

function PairBar({ label, color, width }: { label: string; color: string; width: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="type-accent-s w-16 shrink-0 truncate text-ta-grey-300">{label}</span>
      <div className="relative h-2 flex-1 bg-ta-grey-450">
        {width > 0 && (
          <span
            aria-hidden
            className={cn("absolute inset-y-0 left-0", color)}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[4.5rem_1fr_1fr] gap-x-4";

function Trajectory({ steps, labels }: { steps: TrajectoryStep[]; labels: SideLabels }) {
  const [expanded, setExpanded] = useState<number>();
  const different = steps.filter(stepDiffers);
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
          <span className="truncate">A · {labels.a}</span>
          <span className="truncate">B · {labels.b}</span>
        </div>
        {steps.map((step, row) => {
          const differs = stepDiffers(step);
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

function GenCell({ gen, diverged }: { gen?: Generation; diverged: boolean }) {
  if (gen === undefined) return <span className="text-ta-grey-300">-</span>;
  const doing = stepAction(gen, 80);
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

function PromptSection({ prompt }: { prompt: PromptDiff }) {
  if (prompt.kind === "identical") {
    return (
      <Section label="system prompt">
        <p className="type-body-s text-ta-grey-200">
          {prompt.chars === 0 ? "none in either run" : `identical (${prompt.chars} chars)`}
        </p>
      </Section>
    );
  }
  if (prompt.kind === "too-large") {
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

/** A run's comparable form, from local memory for browser-opened files, else the server. */
async function loadSide(id: string): Promise<ComparableTrace> {
  const local = localTraceItem(id);
  if (local !== undefined) return { trace: local.trace, tools: collectToolDefs(local.raw) };
  const [trace, tools] = await Promise.all([
    fetchJson(`/api/trace?id=${encodeURIComponent(id)}`) as Promise<NormalizedTrace>,
    (fetchJson(`/api/tools?id=${encodeURIComponent(id)}`) as Promise<{ tools: RawToolDef[] }>).then(
      (body) => body.tools,
    ),
  ]);
  return { trace, tools };
}
