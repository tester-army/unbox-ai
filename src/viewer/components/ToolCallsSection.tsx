import type { NormalizedTrace } from "@core/types";
import { allToolCalls } from "@core/normalize";
import { formatCompact, formatMs } from "@core/format";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

interface ToolCallsSectionProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Every tool call in the run, network-inspector style. Columns adapt to the
 * trace: time and status only appear when result payloads report them, and
 * the bar falls back to result size when no durations exist.
 */
export function ToolCallsSection({ trace, selectedIndex, onSelect }: ToolCallsSectionProps) {
  const rows = allToolCalls(trace);
  if (rows.length === 0) return null;
  const hasDuration = rows.some((row) => row.durationMs !== undefined);
  const hasStatus = rows.some((row) => row.success !== undefined);
  const maxDuration = Math.max(...rows.map((row) => row.durationMs ?? 0), 1);
  const maxSize = Math.max(...rows.map((row) => row.result?.length ?? 0), 1);

  const columns = [
    "3rem",
    "minmax(8rem, 14rem)",
    "minmax(10rem, 2fr)",
    ...(hasStatus ? ["4rem"] : []),
    ...(hasDuration ? ["5rem"] : []),
    "4rem",
    "minmax(6rem, 1fr)",
  ].join(" ");
  const grid = { display: "grid", gridTemplateColumns: columns, columnGap: "1rem" } as const;

  return (
    <Section title="tool calls" meta={`${rows.length} calls`}>
      <div className="type-accent-s max-h-80 overflow-x-auto overflow-y-auto px-6 pb-4" role="table">
        <div style={grid} className="border-b border-ta-grey-400 pb-1 text-ta-grey-200" role="row">
          <span role="columnheader">gen</span>
          <span role="columnheader">name</span>
          <span role="columnheader">args</span>
          {hasStatus && <span role="columnheader">status</span>}
          {hasDuration && (
            <span role="columnheader" className="text-right">
              time
            </span>
          )}
          <span role="columnheader" className="text-right" title="result chars">
            size
          </span>
          <span role="columnheader" aria-label={hasDuration ? "duration bar" : "size bar"}>
            {hasDuration ? "waterfall" : ""}
          </span>
        </div>
        {rows.map((row) => {
          const share = hasDuration
            ? (row.durationMs ?? 0) / maxDuration
            : (row.result?.length ?? 0) / maxSize;
          return (
            <button
              key={`${row.gen}:${row.id}`}
              role="row"
              onClick={() => onSelect(row.gen)}
              aria-pressed={row.gen === selectedIndex}
              style={grid}
              className={cn(
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
              <span role="cell" className="truncate normal-case text-ta-grey-200">
                {typeof row.args === "string" ? row.args : JSON.stringify(row.args)}
              </span>
              {hasStatus && <Status success={row.success} hasResult={row.result !== undefined} />}
              {hasDuration && (
                <span role="cell" className="text-right text-ta-grey-100">
                  {row.durationMs !== undefined ? formatMs(row.durationMs) : "-"}
                </span>
              )}
              <span role="cell" className="text-right text-ta-grey-200" title="result chars">
                {row.result !== undefined ? formatCompact(row.result.length) : "-"}
              </span>
              <span role="cell" className="relative h-2 bg-ta-grey-450">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0",
                    row.success === false ? "bg-ta-error" : "bg-ta-orange-300",
                  )}
                  style={{ width: `${share * 100}%` }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </Section>
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
