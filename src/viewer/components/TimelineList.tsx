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
  onScrub: (seconds: number) => void;
  ticks: number[];
}

/** trigger.dev-style event waterfall: one row per event, time track on the right. */
export function TimelineList({
  trace,
  replay,
  selectedIndex,
  onSelect,
  onScrub,
  ticks,
}: TimelineListProps) {
  const { total, starts } = replay;
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [openCall, setOpenCall] = useState<{ call: PairedToolCall; gen: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overTool, setOverTool] = useState(false);

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

  // keep the selected generation in view however it changed: playback,
  // scrubbing, or a jump from the sidebar - smooth so scrubbing glides
  // instead of snapping row to row
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  const track = (fraction: number) => `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${fraction})`;

  const scrubFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    onScrub(fraction * total);
  };

  // click vs drag on the track: a stationary click over a tool row opens it,
  // elsewhere it seeks; dragging scrubs (scrub must not start on pointerdown,
  // or the auto-scroll moves the row before a click's hit-test runs)
  const downAt = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const callsByKey = useMemo(() => {
    const map = new Map<string, { call: PairedToolCall; gen: number }>();
    for (const row of rows) {
      if (row.kind === "tool") map.set(row.key, { call: row.call, gen: row.gen });
    }
    return map;
  }, [rows]);

  const tipsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.kind !== "agent") map.set(row.key, row.tip);
    }
    return map;
  }, [rows]);

  /** Finds the block (bar or dot) under the pointer through the scrub overlay. */
  const blockKeyUnderPointer = (e: React.PointerEvent<HTMLDivElement>): string | null => {
    const overlay = e.currentTarget;
    overlay.style.pointerEvents = "none";
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-block]");
    overlay.style.pointerEvents = "";
    return hit?.getAttribute("data-block") ?? null;
  };

  /** Opens the tool block under the pointer; returns false when none is there. */
  const openToolUnderPointer = (e: React.PointerEvent<HTMLDivElement>): boolean => {
    const key = blockKeyUnderPointer(e);
    const entry = key ? callsByKey.get(key) : undefined;
    if (entry) setOpenCall(entry);
    return entry !== undefined;
  };

  return (
    <div
      className="relative min-h-48 flex-1 overflow-y-auto border border-ta-grey-400 bg-ta-grey-500"
      onMouseLeave={() => setTip(null)}
    >
      <div className="relative">
        {/* the track region is a video-style scrub surface; labels stay clickable */}
        <div
          className={cn(
            "absolute inset-y-0 right-0 z-10",
            dragging ? "cursor-ew-resize" : overTool ? "cursor-pointer" : "cursor-default",
          )}
          style={{ left: LABEL_W }}
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // synthetic or already-released pointers cannot be captured
            }
            downAt.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const down = downAt.current;
            if (!down || e.buttons !== 1) {
              // hovering a block shows its tooltip; empty track stays quiet
              const key = blockKeyUnderPointer(e);
              const text = key ? tipsByKey.get(key) : undefined;
              setTip(text ? { x: e.clientX, y: e.clientY, text } : null);
              setOverTool(key !== null && callsByKey.has(key));
              return;
            }
            if (!down.moved && Math.abs(e.clientX - down.x) < 4 && Math.abs(e.clientY - down.y) < 4) {
              return;
            }
            down.moved = true;
            setDragging(true);
            setTip(null);
            scrubFromEvent(e);
          }}
          onPointerUp={(e) => {
            const down = downAt.current;
            downAt.current = null;
            setDragging(false);
            if (!down) return;
            if (down.moved) return;
            // a click: open the tool under the pointer, else seek there
            if (!openToolUnderPointer(e)) scrubFromEvent(e);
          }}
          onMouseLeave={() => setOverTool(false)}
        />
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
                  className={cn(
                    "type-accent-s min-w-0 shrink-0 truncate pl-8",
                    row.call.success === false ? "text-ta-error" : "text-ta-grey-100",
                  )}
                  style={{ width: LABEL_W }}
                >
                  {row.call.name}
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
                    data-block={row.key}
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
                    data-block={row.key}
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
