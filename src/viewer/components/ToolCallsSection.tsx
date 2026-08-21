import type { NormalizedTrace, PairedToolCall } from "@core/types";
import { formatCompact, formatMs } from "@core/format";
import { cn } from "@/lib/utils";

interface ToolCallRow extends PairedToolCall {
  gen: number;
}

interface ToolCallsSectionProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Every tool call in the run, network-inspector style. Click a row to jump to its generation. */
export function ToolCallsSection({ trace, selectedIndex, onSelect }: ToolCallsSectionProps) {
  const rows: ToolCallRow[] = trace.generations.flatMap((gen) =>
    gen.newMessages.flatMap((m) => (m.toolCalls ?? []).map((call) => ({ ...call, gen: gen.index }))),
  );
  if (rows.length === 0) return null;
  const maxDuration = Math.max(...rows.map((row) => row.durationMs ?? 0), 1);

  return (
    <section className="border-b border-ta-grey-400">
      <div className="flex items-baseline gap-4 px-6 py-3">
        <h2 className="type-accent-m text-ta-sand-50">tool calls</h2>
        <span className="type-accent-s text-ta-grey-200">{rows.length} calls</span>
      </div>
      <div className="type-accent-s px-6 pb-4">
        <div className="grid grid-cols-[3rem_minmax(8rem,1fr)_4rem_5rem_4rem_minmax(6rem,2fr)] gap-x-4 border-b border-ta-grey-400 pb-1 text-ta-grey-200">
          <span>gen</span>
          <span>name</span>
          <span>status</span>
          <span className="text-right">time</span>
          <span className="text-right">size</span>
          <span>waterfall</span>
        </div>
        {rows.map((row) => (
          <button
            key={row.id}
            onClick={() => onSelect(row.gen)}
            aria-pressed={row.gen === selectedIndex}
            className={cn(
              "grid w-full cursor-pointer grid-cols-[3rem_minmax(8rem,1fr)_4rem_5rem_4rem_minmax(6rem,2fr)] items-center gap-x-4 border-b border-ta-grey-450 py-1 text-left transition-colors hover:bg-ta-grey-450",
              row.gen === selectedIndex && "bg-ta-grey-450",
            )}
          >
            <span className="text-ta-grey-200">[{row.gen}]</span>
            <span className="truncate text-ta-sand-50">{row.name}</span>
            <Status success={row.success} hasResult={row.result !== undefined} />
            <span className="text-right text-ta-grey-100">
              {row.durationMs !== undefined ? formatMs(row.durationMs) : "-"}
            </span>
            <span className="text-right text-ta-grey-200">
              {row.result !== undefined ? formatCompact(row.result.length) : "-"}
            </span>
            <span className="relative h-2 bg-ta-grey-450">
              {row.durationMs !== undefined && (
                <span
                  className={cn(
                    "absolute inset-y-0 left-0",
                    row.success === false ? "bg-ta-error" : "bg-ta-orange-300",
                  )}
                  style={{ width: `${(row.durationMs / maxDuration) * 100}%` }}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Status({ success, hasResult }: { success?: boolean; hasResult: boolean }) {
  if (success === false) return <span className="text-ta-error">failed</span>;
  if (success === true) return <span className="text-ta-grey-100">ok</span>;
  return <span className="text-ta-grey-200">{hasResult ? "done" : "-"}</span>;
}
