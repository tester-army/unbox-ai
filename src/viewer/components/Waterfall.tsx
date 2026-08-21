import { Fragment } from "react";
import { toolCallNames } from "@core/normalize";
import type { NormalizedTrace } from "@core/types";
import { formatCallNames, formatCost, formatSeconds, formatTokens } from "@core/format";
import { cn } from "@/lib/utils";

interface WaterfallProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Quiet generation list grouped by segment; metrics live in the tooltip. */
export function Waterfall({ trace, selectedIndex, onSelect }: WaterfallProps) {
  return (
    <div className="flex flex-col pb-6">
      {trace.generations.map((gen, i) => {
        const newSegment = i === 0 || trace.generations[i - 1]?.segment !== gen.segment;
        const calls = formatCallNames(toolCallNames(gen));
        return (
          <Fragment key={gen.index}>
            {newSegment && (
              <p className="type-accent-s mb-1 mt-5 px-4 text-ta-grey-200 first:mt-4">
                segment {gen.segment} · {gen.name}
              </p>
            )}
            <button
              onClick={() => onSelect(gen.index)}
              aria-pressed={gen.index === selectedIndex}
              title={`${formatTokens(gen.metrics.inputTokens)} in / ${formatTokens(gen.metrics.outputTokens)} out · ${formatCost(gen.metrics.cost)}`}
              className={cn(
                "type-accent-s flex cursor-pointer items-center gap-3 border-l-2 border-transparent px-4 py-1.5 text-left transition-colors hover:bg-ta-grey-450",
                gen.index === selectedIndex && "border-ta-orange-300 bg-ta-grey-450",
              )}
            >
              <span className="w-5 shrink-0 text-right text-ta-grey-300">{gen.index}</span>
              <span className="min-w-0 flex-1 truncate text-ta-grey-100">
                {calls || "text response"}
              </span>
              <span className="shrink-0 text-ta-grey-200">
                {formatSeconds(gen.metrics.latency)}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
