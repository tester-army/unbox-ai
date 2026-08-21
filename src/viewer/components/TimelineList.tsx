import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedTrace, PairedToolCall } from "@core/types";
import { formatCost, formatMs, formatSeconds, formatTokens } from "@core/format";
import { CallDialog } from "@/components/CallDialog";
import type { Replay } from "@/lib/use-replay";
import { cn } from "@/lib/utils";

const LABEL_W = "16rem";

type TimelineRow =
  | { kind: "agent"; key: string; name: string }
  | {
      kind: "generation";
      key: string;
      gen: number;
      label: string;
      start: number;
      duration: number;
      tip: string;
    }
  | {
      kind: "tool";
      key: string;
      gen: number;
      call: PairedToolCall;
      start: number;
      tip: string;
    };

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
  const [openCall, setOpenCall] = useState<{ call: PairedToolCall; gen: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const rows = useMemo(() => {
    const out: TimelineRow[] = [];
    let currentAgent: string | null = null;
    trace.generations.forEach((gen, i) => {
      if (gen.name !== currentAgent) {
        currentAgent = gen.name;
        out.push({ kind: "agent", key: `a${i}`, name: gen.name });
      }
      const start = starts[i] ?? 0;
      const m = gen.metrics;
      out.push({
        kind: "generation",
        key: `g${gen.index}`,
        gen: gen.index,
        label: `${gen.index} · ${formatSeconds(m.latency)}`,
        start,
        duration: m.latency,
        tip: `generation ${gen.index} · ${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out · ${formatCost(m.cost)}`,
      });
      for (const message of gen.newMessages) {
        for (const call of message.toolCalls ?? []) {
          const args = typeof call.args === "string" ? call.args : JSON.stringify(call.args);
          out.push({
            kind: "tool",
            key: `g${gen.index}:${call.id}`,
            gen: gen.index,
            call,
            start: start + m.latency,
            tip: `${call.name} ${args.slice(0, 300)}${
              call.durationMs !== undefined ? ` · ${formatMs(call.durationMs)}` : ""
            } · click for output`,
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

  const track = (fraction: number) => `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${fraction})`;

  return (
    <div
      className="relative max-h-[60vh] overflow-y-auto border border-ta-grey-400 bg-ta-grey-500"
      onMouseLeave={() => setTip(null)}
    >
      <div className="relative">
        {ticks.map((t) => (
          <span
            key={t}
            className="pointer-events-none absolute inset-y-0 w-px bg-ta-grey-450"
            style={{ left: track(t / total) }}
          />
        ))}
        <span
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-ta-sand-50"
          style={{ left: track(replay.elapsed / total) }}
        />
        <div className="type-accent-s sticky top-0 z-20 flex border-b border-ta-grey-400 bg-ta-grey-500 py-1.5 text-ta-grey-300">
          <span className="shrink-0 pl-4" style={{ width: LABEL_W }}>
            event
          </span>
          <span className="relative min-w-0 flex-1">
            {ticks.map((t) => (
              <span key={t} className="absolute translate-x-1.5" style={{ left: `${(t / total) * 100}%` }}>
                {formatSeconds(t)}
              </span>
            ))}
          </span>
        </div>
        {rows.map((row) => {
          if (row.kind === "agent") {
            return (
              <p
                key={row.key}
                className="type-accent-s flex h-7 items-center pl-4 pt-1 text-ta-grey-200"
              >
                {row.name}
              </p>
            );
          }
          const selected = row.gen === selectedIndex;
          const isTool = row.kind === "tool";
          return (
            <button
              key={row.key}
              ref={!isTool && selected ? selectedRef : undefined}
              onClick={() => {
                onSelect(row.gen);
                if (isTool) setOpenCall({ call: row.call, gen: row.gen });
              }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: row.tip })}
              onMouseLeave={() => setTip(null)}
              className={cn(
                "flex h-8 w-full cursor-pointer items-center text-left transition-colors hover:bg-ta-grey-450",
                selected && "bg-ta-grey-300/20",
              )}
            >
              {isTool ? (
                <span
                  className="type-accent-s flex min-w-0 shrink-0 items-baseline gap-2 pl-8"
                  style={{ width: LABEL_W }}
                >
                  <span className={cn(row.call.success === false ? "text-ta-error" : "text-ta-grey-100")}>
                    {row.call.name}
                  </span>
                  <span className="min-w-0 truncate normal-case text-ta-grey-300">
                    {typeof row.call.args === "string" ? row.call.args : JSON.stringify(row.call.args)}
                  </span>
                </span>
              ) : (
                <span
                  className={cn(
                    "type-accent-s shrink-0 pl-4",
                    selected ? "text-ta-sand-50" : "text-ta-grey-100",
                  )}
                  style={{ width: LABEL_W }}
                >
                  {row.label}
                </span>
              )}
              <span className="relative h-full min-w-0 flex-1">
                {isTool ? (
                  <span
                    className={cn(
                      "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2",
                      row.call.success === false
                        ? "bg-ta-error"
                        : selected
                          ? "bg-ta-orange-75"
                          : "bg-ta-grey-300",
                    )}
                    style={{ left: `${(row.start / total) * 100}%` }}
                  />
                ) : (
                  <span
                    className={cn(
                      "absolute top-1/2 h-3.5 -translate-y-1/2",
                      selected ? "bg-ta-orange-300" : "bg-ta-grey-300",
                    )}
                    style={{
                      left: `${(row.start / total) * 100}%`,
                      width: `max(${(row.duration / total) * 100}%, 4px)`,
                    }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
      {tip && (
        <div
          className="type-accent-s pointer-events-none fixed z-30 max-w-96 truncate border border-ta-grey-400 bg-ta-grey-500 px-3 py-1.5 normal-case text-ta-grey-100"
          style={{ left: Math.min(tip.x + 14, window.innerWidth - 400), top: tip.y + 14 }}
        >
          {tip.text}
        </div>
      )}
      {openCall && (
        <CallDialog call={openCall.call} gen={openCall.gen} onClose={() => setOpenCall(null)} />
      )}
    </div>
  );
}
