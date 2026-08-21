import { useEffect, useMemo, useRef } from "react";
import type { NormalizedTrace } from "@core/types";
import { formatMs, formatSeconds } from "@core/format";
import type { Replay } from "@/lib/use-replay";
import { cn } from "@/lib/utils";

interface TimelineRow {
  key: string;
  gen: number;
  agent: string;
  kind: "generation" | "tool";
  label: string;
  detail?: string;
  /** Position on the model-time axis, seconds. */
  start: number;
  /** Bar length; 0 renders a dot. */
  duration: number;
  failed?: boolean;
}

interface TimelineListProps {
  trace: NormalizedTrace;
  replay: Replay;
  selectedIndex: number;
  onSelect: (index: number) => void;
  ticks: number[];
}

/** trigger.dev-style event waterfall: one row per event, time track on the right. */
export function TimelineList({ trace, replay, selectedIndex, onSelect, ticks }: TimelineListProps) {
  const { total, starts } = replay;
  const selectedRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => {
    const out: TimelineRow[] = [];
    trace.generations.forEach((gen, i) => {
      const start = starts[i] ?? 0;
      out.push({
        key: `g${gen.index}`,
        gen: gen.index,
        agent: gen.name,
        kind: "generation",
        label: `${gen.name} · generation ${gen.index}`,
        detail: formatSeconds(gen.metrics.latency),
        start,
        duration: gen.metrics.latency,
      });
      for (const message of gen.newMessages) {
        for (const call of message.toolCalls ?? []) {
          out.push({
            key: `g${gen.index}:${call.id}`,
            gen: gen.index,
            agent: gen.name,
            kind: "tool",
            label: call.name,
            detail: call.durationMs !== undefined ? formatMs(call.durationMs) : undefined,
            start: start + gen.metrics.latency,
            duration: 0,
            failed: call.success === false,
          });
        }
      }
    });
    return out;
  }, [trace, starts]);

  useEffect(() => {
    if (replay.playing) {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [replay.playing, selectedIndex]);

  return (
    <div className="relative max-h-[36rem] overflow-y-auto border border-ta-grey-400 bg-ta-grey-500">
      <div className="relative">
        {/* gridlines span the full scrollable height */}
        {ticks.map((t) => (
          <span
            key={t}
            className="pointer-events-none absolute inset-y-0 w-px bg-ta-grey-450"
            style={{ left: `calc(18rem + (100% - 18rem) * ${t / total})` }}
          />
        ))}
        <span
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-ta-sand-50"
          style={{ left: `calc(18rem + (100% - 18rem) * ${replay.elapsed / total})` }}
        />
        <div className="type-accent-s sticky top-0 z-20 flex border-b border-ta-grey-400 bg-ta-grey-500 py-1 text-ta-grey-300">
          <span className="w-72 shrink-0 pl-3">event</span>
          <span className="relative min-w-0 flex-1">
            {ticks.map((t) => (
              <span key={t} className="absolute translate-x-1" style={{ left: `${(t / total) * 100}%` }}>
                {formatSeconds(t)}
              </span>
            ))}
          </span>
        </div>
        {rows.map((row) => {
          const selected = row.gen === selectedIndex;
          return (
            <button
              key={row.key}
              ref={selected && row.kind === "generation" ? selectedRef : undefined}
              onClick={() => onSelect(row.gen)}
              className={cn(
                "flex h-6 w-full cursor-pointer items-center text-left transition-colors hover:bg-ta-grey-450",
                selected && "bg-ta-grey-300/20",
              )}
            >
              <span
                className={cn(
                  "type-accent-s w-72 shrink-0 truncate",
                  row.kind === "tool" ? "pl-8" : "pl-3",
                  row.kind === "generation"
                    ? selected
                      ? "text-ta-sand-50"
                      : "text-ta-grey-100"
                    : "text-ta-grey-200",
                  row.failed && "text-ta-error",
                )}
                title={row.label}
              >
                {row.label}
                {row.detail && <span className="text-ta-grey-300"> · {row.detail}</span>}
                {row.failed && " · failed"}
              </span>
              <span className="relative h-full min-w-0 flex-1">
                {row.duration > 0 ? (
                  <span
                    className={cn(
                      "absolute top-1/2 h-2 -translate-y-1/2",
                      selected ? "bg-ta-orange-300" : "bg-ta-grey-300",
                    )}
                    style={{
                      left: `${(row.start / total) * 100}%`,
                      width: `max(${(row.duration / total) * 100}%, 3px)`,
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      "absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2",
                      row.failed ? "bg-ta-error" : selected ? "bg-ta-orange-75" : "bg-ta-grey-300",
                    )}
                    style={{ left: `${(row.start / total) * 100}%` }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
