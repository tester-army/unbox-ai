import type { RunSummary } from "@core/collection";
import { formatTokens } from "@core/format";
import { cn } from "@/lib/utils";

interface RunListProps {
  runs: RunSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

/** Newest-first list of independent runs; each run opens as its own trace. */
export function RunList({ runs, selectedId, onSelect }: RunListProps) {
  return (
    <div className="border-b border-ta-grey-400 pb-3">
      <p className="type-accent-s mb-1 mt-4 px-4 text-ta-grey-200">
        runs · {runs.length}
      </p>
      {runs
        .map((run, number) => ({ run, number }))
        .reverse()
        .map(({ run, number }) => {
          const selected = run.id === selectedId;
          return (
            <button
              key={run.id}
              onClick={() => onSelect(run.id)}
              aria-pressed={selected}
              title={`${formatTokens(run.totalTokens.input)} in / ${formatTokens(run.totalTokens.output)} out · ${run.models.join(", ")} · ${new Date(run.timestamp).toLocaleTimeString()}`}
              className={cn(
                "type-accent-s flex w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-ta-grey-450",
                selected && "bg-ta-grey-300/25",
              )}
            >
              <span
                className={cn(
                  "w-5 shrink-0 text-right",
                  selected ? "text-ta-orange-300" : "text-ta-grey-300",
                )}
              >
                {number}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  selected ? "text-ta-sand-50" : "text-ta-grey-100",
                )}
              >
                {run.name}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  run.inProgress
                    ? "text-ta-orange-300"
                    : selected
                      ? "text-ta-sand-50"
                      : "text-ta-grey-200",
                )}
              >
                {run.inProgress ? "live" : `${run.generations} gen`}
              </span>
            </button>
          );
        })}
    </div>
  );
}
