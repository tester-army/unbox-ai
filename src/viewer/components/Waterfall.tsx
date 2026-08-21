import { Fragment } from "react";
import { toolCallNames } from "@core/normalize";
import type { NormalizedTrace } from "@core/types";
import { formatSeconds, formatTokens } from "@core/format";
import { cn } from "@/lib/utils";

interface WaterfallProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Compact generation list grouped by segment. */
export function Waterfall({ trace, selectedIndex, onSelect }: WaterfallProps) {
  return (
    <div className="flex flex-col">
      <p className="type-accent-s border-b border-ta-grey-400 px-4 py-3 text-ta-grey-200">
        generations
      </p>
      {trace.generations.map((gen, i) => {
        const newSegment = i === 0 || trace.generations[i - 1]?.segment !== gen.segment;
        const calls = toolCallNames(gen);
        return (
          <Fragment key={gen.index}>
            {newSegment && (
              <p className="type-accent-s border-b border-ta-grey-400 bg-ta-grey-450 px-4 py-1 text-ta-grey-200">
                segment {gen.segment}
              </p>
            )}
            <button
              onClick={() => onSelect(gen.index)}
              aria-pressed={gen.index === selectedIndex}
              className={cn(
                "type-accent-s flex cursor-pointer items-baseline gap-2 border-b border-l-2 border-ta-grey-400 border-l-transparent px-4 py-2 text-left transition-colors hover:bg-ta-grey-450",
                gen.index === selectedIndex && "border-l-ta-orange-300 bg-ta-grey-450",
              )}
            >
              <span className="text-ta-sand-50">[{gen.index}]</span>
              <span className="min-w-0 flex-1 truncate text-ta-grey-100">
                {calls.length > 0 ? calls.join(", ") : "text response"}
              </span>
              <span className="shrink-0 text-ta-grey-200">
                {formatTokens(gen.metrics.inputTokens)} · {formatSeconds(gen.metrics.latency)}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
