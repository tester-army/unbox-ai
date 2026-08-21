import type { NormalizedTrace } from "@core/types";
import { allToolCalls } from "@core/normalize";
import { formatCompact, formatMs } from "@core/format";
import { cn } from "@/lib/utils";

const GRID = "grid grid-cols-[3rem_minmax(8rem,1fr)_4rem_5rem_4rem_minmax(6rem,2fr)] gap-x-4";

interface ToolCallsSectionProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Every tool call in the run, network-inspector style. Click a row to jump to its generation. */
export function ToolCallsSection({ trace, selectedIndex, onSelect }: ToolCallsSectionProps) {
  const rows = allToolCalls(trace);
  if (rows.length === 0) return null;
  const maxDuration = Math.max(...rows.map((row) => row.durationMs ?? 0), 1);

  return (
    <section className="border-b border-ta-grey-400">
      <div className="flex items-baseline gap-4 px-6 py-3">
        <h2 className="type-accent-m text-ta-sand-50">tool calls</h2>
        <span className="type-accent-s text-ta-grey-200">{rows.length} calls</span>
      </div>
      <div className="type-accent-s max-h-80 overflow-x-auto overflow-y-auto px-6 pb-4" role="table">
        <div className={cn(GRID, "border-b border-ta-grey-400 pb-1 text-ta-grey-200")} role="row">
          <span role="columnheader">gen</span>
          <span role="columnheader">name</span>
          <span role="columnheader">status</span>
          <span role="columnheader" className="text-right">
            time
          </span>
          <span role="columnheader" className="text-right" title="result chars">
            size
          </span>
          <span role="columnheader">waterfall</span>
        </div>
        {rows.map((row) => (
          <button
            key={`${row.gen}:${row.id}`}
            role="row"
            onClick={() => onSelect(row.gen)}
            aria-pressed={row.gen === selectedIndex}
            className={cn(
              GRID,
              "w-full cursor-pointer items-center border-b border-ta-grey-450 py-1 text-left transition-colors hover:bg-ta-grey-450",
              row.gen === selectedIndex && "bg-ta-grey-450",
            )}
          >
            <span role="cell" className="text-ta-grey-200">
              [{row.gen}]
            </span>
            <span role="cell" className="truncate text-ta-sand-50">
              {row.name}
            </span>
            <Status success={row.success} hasResult={row.result !== undefined} />
            <span role="cell" className="text-right text-ta-grey-100">
              {row.durationMs !== undefined ? formatMs(row.durationMs) : "-"}
            </span>
            <span role="cell" className="text-right text-ta-grey-200" title="result chars">
              {row.result !== undefined ? formatCompact(row.result.length) : "-"}
            </span>
            <span role="cell" className="relative h-2 bg-ta-grey-450">
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
  if (success === false)
    return (
      <span role="cell" className="truncate text-ta-error">
        failed
      </span>
    );
  if (success === true)
    return (
      <span role="cell" className="text-ta-grey-100">
        ok
      </span>
    );
  return (
    <span role="cell" className="text-ta-grey-200">
      {hasResult ? "done" : "-"}
    </span>
  );
}
