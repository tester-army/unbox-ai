import type { RunSummary } from "@core/collection";
import {
  type ComparableTrace,
  compareTraces,
  metricDelta,
  metricValue,
  type TraceComparison,
} from "@core/compare";
import type { NormalizedTrace, RawTrace } from "@core/types";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { localTraceItem } from "@/lib/use-trace";
import { cn } from "@/lib/utils";

interface CompareDialogProps {
  runs: RunSummary[];
  /** Run preselected as side A, normally the one on screen. */
  initialA: string;
  onClose: () => void;
}

/** A/B comparison of two runs: metric deltas, system prompt diff, tool-set diff. */
export function CompareDialog({ runs, initialA, onClose }: CompareDialogProps) {
  const [aId, setAId] = useState(initialA);
  const [bId, setBId] = useState(
    () => (runs.find((run) => run.id !== initialA) ?? runs[0])?.id ?? initialA,
  );
  const [comparison, setComparison] = useState<TraceComparison>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stale = false;
    setComparison(undefined);
    setError(undefined);
    Promise.all([loadSide(aId), loadSide(bId)])
      .then(([a, b]) => {
        if (!stale) setComparison(compareTraces(a, b));
      })
      .catch((cause) => {
        if (!stale) setError(String(cause));
      });
    return () => {
      stale = true;
    };
  }, [aId, bId]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <div className="flex items-center gap-3 border-b border-ta-grey-400 px-5 py-3">
          <DialogTitle>compare runs</DialogTitle>
          <DialogClose render={<Button className="ml-auto border-none">close</Button>} />
        </div>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-4">
          <div className="flex items-center gap-3">
            <RunSelect side="A" runs={runs} value={aId} onChange={setAId} />
            <span className="type-accent-s text-ta-grey-300">vs</span>
            <RunSelect side="B" runs={runs} value={bId} onChange={setBId} />
          </div>
          {error && <p className="type-body-s text-ta-error">Failed to compare: {error}</p>}
          {!error && !comparison && (
            <p className="type-accent-s text-ta-grey-200">loading runs...</p>
          )}
          {comparison && <Comparison comparison={comparison} />}
        </div>
      </DialogContent>
    </Dialog>
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

function Comparison({ comparison }: { comparison: TraceComparison }) {
  const { models, metrics, systemPrompt, tools } = comparison;
  const sameModels = models.a.join(", ") === models.b.join(", ");
  return (
    <>
      <p className="type-accent-s text-ta-grey-200">
        models{" "}
        <span className="text-ta-sand-50">
          {sameModels
            ? models.a.join(", ")
            : `A: ${models.a.join(", ")}  B: ${models.b.join(", ")}`}
        </span>
      </p>
      <div className="type-accent-s grid grid-cols-[1fr_auto_auto_auto] gap-x-6 gap-y-1.5">
        <HeaderCell>metric</HeaderCell>
        <HeaderCell right>A</HeaderCell>
        <HeaderCell right>B</HeaderCell>
        <HeaderCell right>delta</HeaderCell>
        {metrics.map((m) => {
          const delta = metricDelta(m);
          return (
            <div key={m.key} className="contents">
              <span className="text-ta-grey-200">{m.key}</span>
              <span className="text-right text-ta-grey-100">{metricValue(m.kind, m.a)}</span>
              <span className="text-right text-ta-grey-100">{metricValue(m.kind, m.b)}</span>
              <span
                className={cn("text-right", delta === "=" ? "text-ta-grey-300" : "text-ta-sand-50")}
              >
                {delta}
              </span>
            </div>
          );
        })}
      </div>
      <PromptSection prompt={systemPrompt} />
      <ToolsSection tools={tools} />
    </>
  );
}

function HeaderCell({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <span className={cn("text-ta-grey-300", right && "text-right")}>{children}</span>;
}

/** Full diff is rendered; the dialog body scrolls. */
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
