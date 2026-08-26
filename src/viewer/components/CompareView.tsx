import type { RunSummary } from "@core/collection";
import {
  type ComparableTrace,
  type ComparedMetric,
  collectToolDefs,
  compareTraces,
  finalText,
  metricDelta,
  metricValue,
  type PromptDiff,
  pairTrajectory,
  stepAction,
  stepDiffers,
  stepIndexLabel,
  systemPrompt,
  type ToolChange,
  type ToolUsageDelta,
  type TraceComparison,
  type TrajectoryStep,
  taskPrompt,
  toolDefParts,
} from "@core/compare";
import { formatSeconds, formatTokens } from "@core/format";
import type { Generation, NormalizedTrace, RawToolDef } from "@core/types";
import { MultiFileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { MessageCard } from "@/components/MessageCard";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Section } from "@/components/ui/section";
import { fetchJson } from "@/lib/api";
import { localTraceItem } from "@/lib/local-traces";
import { basename, cn } from "@/lib/utils";

interface CompareViewProps {
  runs: RunSummary[];
  /** Run preselected as side A, normally the one on screen. */
  initialA: string;
  onClose: () => void;
}

interface Sides {
  a: ComparableTrace;
  b: ComparableTrace;
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
  const [sides, setSides] = useState<Sides>();
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
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {error && <p className="type-body-s p-6 text-ta-error">Failed to compare: {error}</p>}
        {!error && comparison === undefined && (
          <p className="type-accent-s p-6 text-ta-grey-200">loading runs...</p>
        )}
        {sides && comparison && steps && (
          <>
            <MetricsGrid comparison={comparison} labels={labels} />
            <DiffSection
              title="task"
              fileName="task.md"
              diff={comparison.task}
              a={taskPrompt(sides.a.trace)}
              b={taskPrompt(sides.b.trace)}
            />
            <ToolUsageSection usage={comparison.toolUsage} />
            <Trajectory steps={steps} labels={labels} />
            <DiffSection
              title="system prompt"
              fileName="system-prompt.md"
              diff={comparison.systemPrompt}
              a={systemPrompt(sides.a.trace)}
              b={systemPrompt(sides.b.trace)}
            />
            <ToolsSection tools={comparison.tools} sides={sides} />
            <OutcomeSection
              a={finalText(sides.a.trace)}
              b={finalText(sides.b.trace)}
              labels={labels}
            />
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
      title="totals"
      meta={
        sameModels
          ? models.a.join(", ")
          : `${labels.a}: ${models.a.join(", ")} · ${labels.b}: ${models.b.join(", ")}`
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 px-6 pb-4">
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
      title="trajectory"
      meta={
        different.length === 0
          ? "aligned by action · same actions throughout"
          : `aligned by action · differs at ${different.length} of ${steps.length} steps`
      }
      defaultOpen={false}
    >
      <div className="mx-6 mb-4 border border-ta-grey-400">
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

/** A named text (task, system prompt) diffed A vs B; identical stays collapsed. */
function DiffSection({
  title,
  fileName,
  diff,
  a,
  b,
}: {
  title: string;
  fileName: string;
  diff: PromptDiff;
  a: string;
  b: string;
}) {
  if (diff.kind === "identical") {
    return (
      <Section
        title={title}
        meta={diff.chars === 0 ? "none in either run" : `identical (${diff.chars} chars)`}
        defaultOpen={false}
      >
        <p className="type-body-s px-6 pb-4 text-ta-grey-200">
          {diff.chars === 0 ? "neither run carries one" : "both runs carry the same text"}
        </p>
      </Section>
    );
  }
  return (
    <Section
      title={title}
      meta={
        diff.kind === "differs"
          ? `+${diff.addedLines} / -${diff.removedLines} lines`
          : `differs (A ${diff.aChars} chars, B ${diff.bChars} chars)`
      }
    >
      <div className="px-6 pb-4">
        <TextDiff name={fileName} before={a} after={b} />
      </div>
    </Section>
  );
}

const USAGE_GRID =
  "grid grid-cols-[minmax(9rem,1fr)_4rem_4rem_7rem_6rem_9rem] items-baseline gap-x-4";

/** Per-tool call activity of both runs; rows with identical activity dim. */
function ToolUsageSection({ usage }: { usage: ToolUsageDelta[] }) {
  if (usage.length === 0) return null;
  const changedRows = usage.filter(
    (u) => u.a.calls !== u.b.calls || u.a.failures !== u.b.failures,
  ).length;
  const pair = (a: number, b: number, render: (v: number) => string) =>
    a === 0 && b === 0 ? "-" : `${render(a)} -> ${render(b)}`;
  return (
    <Section
      title="tool usage"
      meta={
        changedRows === 0
          ? "identical call counts"
          : `${changedRows} of ${usage.length} tools used differently`
      }
      defaultOpen={changedRows > 0}
    >
      <div className="type-accent-s px-6 pb-4">
        <div className={cn(USAGE_GRID, "border-b border-ta-grey-400 pb-1 text-ta-grey-200")}>
          <span>tool</span>
          <span className="text-right">A</span>
          <span className="text-right">B</span>
          <span className="text-right">delta</span>
          <span className="text-right">failures</span>
          <span className="text-right">time</span>
        </div>
        {usage.map((u) => {
          const equal = u.a.calls === u.b.calls && u.a.failures === u.b.failures;
          return (
            <div
              key={u.name}
              className={cn(
                USAGE_GRID,
                "border-b border-ta-grey-450 py-1.5",
                equal && "opacity-55",
              )}
            >
              <span className="truncate text-ta-sand-50">{u.name}</span>
              <span className="text-right text-ta-grey-100">{u.a.calls}</span>
              <span className="text-right text-ta-grey-100">{u.b.calls}</span>
              <span className={cn("text-right", equal ? "text-ta-grey-300" : "text-ta-orange-300")}>
                {metricDelta({ key: u.name, kind: "count", a: u.a.calls, b: u.b.calls })}
              </span>
              <span
                className={cn(
                  "text-right",
                  u.a.failures + u.b.failures > 0 ? "text-ta-error" : "text-ta-grey-300",
                )}
              >
                {pair(u.a.failures, u.b.failures, String)}
              </span>
              <span className="text-right text-ta-grey-200">
                {pair(u.a.seconds, u.b.seconds, formatSeconds)}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** What each run concluded: the final assistant messages side by side. */
function OutcomeSection({ a, b, labels }: { a: string; b: string; labels: SideLabels }) {
  if (a === "" && b === "") return null;
  return (
    <Section title="outcome" meta="final assistant message of each run">
      <div className="grid grid-cols-2 gap-3 px-6 pb-4">
        <OutcomeCard label={`A · ${labels.a}`} text={a} />
        <OutcomeCard label={`B · ${labels.b}`} text={b} />
      </div>
    </Section>
  );
}

function OutcomeCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border border-ta-grey-400 bg-ta-grey-450/40 px-4 py-3">
      <span className="type-accent-s text-ta-grey-200">{label}</span>
      {text === "" ? (
        <p className="type-accent-s text-ta-grey-300">no assistant text in this run</p>
      ) : (
        <div className="type-body-s max-h-96 overflow-y-auto">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}

/** Shared @pierre/diffs settings; unchanged stretches collapse behind expanders. */
const DIFF_OPTIONS = {
  theme: "pierre-dark",
  themeType: "dark",
  diffStyle: "split",
  disableFileHeader: true,
  overflow: "wrap",
} as const;

/** A split before/after diff of two texts; `name`'s extension picks the highlighting. */
function TextDiff({ name, before, after }: { name: string; before: string; after: string }) {
  const oldFile = useMemo(() => ({ name, contents: before }), [name, before]);
  const newFile = useMemo(() => ({ name, contents: after }), [name, after]);
  return (
    <div className="overflow-hidden border border-ta-grey-400">
      <MultiFileDiff oldFile={oldFile} newFile={newFile} options={DIFF_OPTIONS} />
    </div>
  );
}

/** One row of the tool-set diff: an added, removed, or changed tool. */
interface ToolRow {
  sign: "+" | "-" | "~";
  signClass: string;
  name: string;
  summary: string;
  parts: ToolChange["parts"];
  a?: RawToolDef;
  b?: RawToolDef;
}

function ToolsSection({ tools, sides }: { tools: TraceComparison["tools"]; sides: Sides }) {
  const [expanded, setExpanded] = useState<string>();
  const total = tools.unchanged + tools.changed.length + tools.added.length + tools.removed.length;
  const rows = useMemo(() => toolRows(tools, sides), [tools, sides]);
  const counts = [
    ...(tools.added.length > 0 ? [`+${tools.added.length} added`] : []),
    ...(tools.removed.length > 0 ? [`-${tools.removed.length} removed`] : []),
    ...(tools.changed.length > 0 ? [`~${tools.changed.length} changed`] : []),
    `${tools.unchanged} unchanged`,
  ];
  return (
    <Section title="tools" meta={counts.join(" · ")} defaultOpen={rows.length > 0}>
      <div className="px-6 pb-4">
        {total === 0 ? (
          <p className="type-body-s text-ta-grey-200">none in either run</p>
        ) : rows.length === 0 ? (
          <p className="type-body-s text-ta-grey-200">identical tool set</p>
        ) : (
          <div className="type-body-s border border-ta-grey-400">
            {rows.map((row) => (
              <div key={row.name} className="border-b border-ta-grey-400 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === row.name ? undefined : row.name)}
                  aria-expanded={expanded === row.name}
                  className={cn(
                    "flex w-full cursor-pointer items-baseline gap-3 px-4 py-2 text-left transition-colors hover:bg-ta-grey-450",
                    expanded === row.name && "bg-ta-grey-450",
                  )}
                >
                  <span className={row.signClass}>
                    {row.sign} {row.name}
                  </span>
                  <span className="text-ta-grey-300">{row.summary}</span>
                </button>
                {expanded === row.name && <ToolDefDiff row={row} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

/** Added, removed, then changed tools, each with what to show when expanded. */
function toolRows(tools: TraceComparison["tools"], sides: Sides): ToolRow[] {
  const defs = {
    a: new Map(sides.a.tools.map((def) => [def.name, def])),
    b: new Map(sides.b.tools.map((def) => [def.name, def])),
  };
  const presentParts = (def: RawToolDef | undefined): ToolChange["parts"] => {
    if (def === undefined) return [];
    const parts = toolDefParts(def);
    return [
      ...(parts.description !== "" ? (["description"] as const) : []),
      ...(parts.schema !== "" ? (["schema"] as const) : []),
    ];
  };
  return [
    ...tools.added.map((name): ToolRow => {
      const b = defs.b.get(name);
      return {
        sign: "+",
        signClass: "text-ta-orange-75",
        name,
        summary: "only in B",
        parts: presentParts(b),
        ...(b !== undefined ? { b } : {}),
      };
    }),
    ...tools.removed.map((name): ToolRow => {
      const a = defs.a.get(name);
      return {
        sign: "-",
        signClass: "text-ta-error",
        name,
        summary: "only in A",
        parts: presentParts(a),
        ...(a !== undefined ? { a } : {}),
      };
    }),
    ...tools.changed.map(
      (change): ToolRow => ({
        sign: "~",
        signClass: "text-ta-sand-50",
        name: change.name,
        summary: changeSummary(change),
        parts: change.parts,
        ...(defs.a.has(change.name) ? { a: defs.a.get(change.name) } : {}),
        ...(defs.b.has(change.name) ? { b: defs.b.get(change.name) } : {}),
      }),
    ),
  ];
}

/**
 * A tool's definition parts, each as its own before/after diff. Added and
 * removed tools diff against nothing, rendering as all-new or all-gone.
 */
function ToolDefDiff({ row }: { row: ToolRow }) {
  const empty = { description: "", schema: "" };
  const partsA = row.a !== undefined ? toolDefParts(row.a) : empty;
  const partsB = row.b !== undefined ? toolDefParts(row.b) : empty;
  return (
    <div className="flex flex-col gap-3 border-t border-ta-grey-400 px-4 py-3">
      {row.parts.includes("description") && (
        <TextDiff name={`${row.name}.md`} before={partsA.description} after={partsB.description} />
      )}
      {row.parts.includes("schema") && (
        <TextDiff name={`${row.name}.schema.json`} before={partsA.schema} after={partsB.schema} />
      )}
    </div>
  );
}

/** "description + schema · +3/-1 lines" style. */
function changeSummary(change: ToolChange): string {
  if (change.lines === undefined) return change.parts.join(" + ");
  const added = change.lines.filter((line) => line.kind === "added").length;
  const removed = change.lines.filter((line) => line.kind === "removed").length;
  return `${change.parts.join(" + ")} · +${added}/-${removed} lines`;
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
