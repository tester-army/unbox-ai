import { Fragment } from "react";
import { toolCallNames } from "@core/normalize";
import type { NormalizedTrace } from "@core/types";
import { formatCost, formatSeconds, formatTokens } from "@core/format";
import { cn } from "@/lib/utils";

interface WaterfallProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** One row per generation: latency bar with TTFT tick, tokens, cost. */
export function Waterfall({ trace, selectedIndex, onSelect }: WaterfallProps) {
  const maxLatency = Math.max(...trace.generations.map((g) => g.metrics.latency)) || 1;
  return (
    <div className="flex flex-col">
      <p className="type-accent-s border-b border-ta-grey-400 px-4 py-3 text-ta-grey-200">
        timeline
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
                "cursor-pointer border-b border-l-2 border-ta-grey-400 border-l-transparent px-4 py-2 text-left transition-colors hover:bg-ta-grey-450",
                gen.index === selectedIndex && "border-l-ta-orange-300 bg-ta-grey-450",
              )}
            >
              <div className="type-accent-s flex justify-between text-ta-grey-100">
                <span>
                  <span className="text-ta-sand-50">[{gen.index}]</span>{" "}
                  {calls.length > 0 ? calls.join(", ") : "text response"}
                </span>
                <span>{formatSeconds(gen.metrics.latency)}</span>
              </div>
              <div className="relative mt-1.5 h-2 w-full bg-ta-grey-450">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0",
                    gen.index === selectedIndex ? "bg-ta-orange-300" : "bg-ta-grey-300",
                  )}
                  style={{ width: `${(gen.metrics.latency / maxLatency) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 w-px bg-ta-sand-50"
                  style={{
                    left: `${(gen.metrics.timeToFirstToken / maxLatency) * 100}%`,
                  }}
                  title={`ttft ${formatSeconds(gen.metrics.timeToFirstToken)}`}
                />
              </div>
              <div className="type-accent-s mt-1.5 flex gap-4 text-ta-grey-200">
                <span>{formatTokens(gen.metrics.inputTokens)} in</span>
                <span>{formatTokens(gen.metrics.outputTokens)} out</span>
                <span>{formatCost(gen.metrics.cost)}</span>
              </div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
