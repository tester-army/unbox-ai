import { formatPercent, formatSeconds } from "@core/format";
import type { NormalizedTrace } from "@core/types";
import { useEffect, useRef, useState } from "react";
import { TimelineList } from "@/components/TimelineList";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Section } from "@/components/ui/section";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Replay, SPEEDS } from "@/lib/use-replay";
import { cn } from "@/lib/utils";

interface ReplayBarProps {
  trace: NormalizedTrace;
  replay: Replay;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Model-time gantt of the run with a replay playhead. Each block is one
 * generation sized by latency; the darker left part is time-to-first-token,
 * and the bottom strip splits its input into repeated prefix vs fresh tokens.
 */
export function ReplayBar({ trace, replay, selectedIndex, onSelect }: ReplayBarProps) {
  const { total, starts } = replay;
  const [view, setView] = useState<"timeline" | "lanes">("timeline");
  const [fullscreen, setFullscreen] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const step = tickStep(total);
  const ticks: number[] = [];
  for (let t = step; t < total; t += step) ticks.push(t);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // video-style scrubbing: pause, move the clock, and follow with selection
  const scrub = (seconds: number) => {
    replay.pause();
    replay.seek(seconds);
    const index = starts.findLastIndex((start) => start <= seconds);
    if (index >= 0) onSelect(index);
  };

  return (
    <Section
      title="time"
      hint="time chart"
      className="flex min-h-0 flex-1 flex-col"
      meta={
        <>
          {formatSeconds(trace.totalLatency)} <Hint term="model time">model time</Hint>
          {total > trace.totalLatency &&
            ` · ${formatSeconds(total - trace.totalLatency)} tool execution`}
          {" · drag the timeline to scrub"}
        </>
      }
      actions={
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="timeline">timeline</TabsTrigger>
            <TabsTrigger value="lanes">lanes</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <div
        ref={playerRef}
        className={cn("flex min-h-0 flex-1 flex-col px-6 pb-4", fullscreen && "bg-ta-grey-500 p-4")}
      >
        {total <= 0 ? (
          <p className="type-accent-s border border-ta-grey-400 px-3 py-2 text-ta-grey-200">
            no latency data in this trace
          </p>
        ) : (
          <>
            {view === "timeline" ? (
              <TimelineList
                trace={trace}
                replay={replay}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
                onScrub={scrub}
                ticks={ticks}
              />
            ) : (
              <Lanes
                trace={trace}
                replay={replay}
                selectedIndex={selectedIndex}
                onSelect={onSelect}
              />
            )}
            <PlayerControls
              replay={replay}
              onScrub={scrub}
              playerRef={playerRef}
              fullscreen={fullscreen}
            />
          </>
        )}
      </div>
    </Section>
  );
}

interface PlayerControlsProps {
  replay: Replay;
  onScrub: (seconds: number) => void;
  playerRef: React.RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
}

/** Video-player bar: play, speed, a scrubbable progress track, time, fullscreen. */
function PlayerControls({ replay, onScrub, playerRef, fullscreen }: PlayerControlsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubFromEvent = (e: React.PointerEvent) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    onScrub(fraction * replay.total);
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border border-t-0 border-ta-grey-400 bg-ta-grey-500 px-3">
      <Button onClick={replay.toggle}>{replay.playing ? "pause" : "play"}</Button>
      <Tabs value={String(replay.speed)} onValueChange={(v) => replay.setSpeed(Number(v))}>
        <TabsList>
          {SPEEDS.map((speed) => (
            <TabsTrigger key={speed} value={String(speed)}>
              {speed}x
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div
        ref={trackRef}
        className="relative h-7 min-w-0 flex-1 cursor-ew-resize border border-ta-grey-400 bg-ta-grey-450"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // synthetic or already-released pointers cannot be captured
          }
          scrubFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) scrubFromEvent(e);
        }}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 bg-ta-orange-300/40"
          style={{ width: `${(replay.elapsed / replay.total) * 100}%` }}
        />
        <span
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-ta-sand-50"
          style={{ left: `${(replay.elapsed / replay.total) * 100}%` }}
        />
      </div>
      <span className="type-accent-s shrink-0 text-ta-grey-100">
        {formatSeconds(replay.elapsed)} / {formatSeconds(replay.total)}
      </span>
      <Button
        onClick={() => {
          if (fullscreen) void document.exitFullscreen();
          else void playerRef.current?.requestFullscreen();
        }}
      >
        {fullscreen ? "exit" : "fullscreen"}
      </Button>
    </div>
  );
}

const LANE_H = 26;
const AXIS_H = 20;

/**
 * DevTools-network-style overview: one lane per agent so interleaving is
 * visible, blocks on a shared time axis with tick gridlines.
 */
function Lanes({ trace, replay, selectedIndex, onSelect }: ReplayBarProps) {
  const { total, starts } = replay;
  const lanes = [...new Set(trace.generations.map((g) => g.name))];
  const plotHeight = lanes.length * LANE_H;
  const step = tickStep(total);
  const ticks: number[] = [];
  for (let t = step; t < total; t += step) ticks.push(t);

  return (
    <div className="flex">
      <div className="w-32 shrink-0" style={{ paddingBottom: AXIS_H }}>
        {lanes.map((name) => (
          <p
            key={name}
            className="type-accent-s flex items-center truncate border-y border-transparent pr-3 text-right text-ta-grey-200"
            style={{ height: LANE_H }}
            title={name}
          >
            <span className="w-full truncate">{name}</span>
          </p>
        ))}
      </div>
      <div
        className="relative min-w-0 flex-1 border border-ta-grey-400 bg-ta-grey-500"
        style={{ height: plotHeight + AXIS_H }}
      >
        {ticks.map((t) => (
          <span key={t} className="absolute top-0" style={{ left: `${(t / total) * 100}%` }}>
            <span className="absolute w-px bg-ta-grey-450" style={{ height: plotHeight }} />
            <span
              className="type-accent-s absolute translate-x-1 text-ta-grey-300"
              style={{ top: plotHeight + 2 }}
            >
              {formatSeconds(t)}
            </span>
          </span>
        ))}
        {trace.generations.map((gen) => {
          const { latency, timeToFirstToken } = gen.metrics;
          const ttftShare =
            latency > 0 && timeToFirstToken !== undefined
              ? Math.min(timeToFirstToken / latency, 1)
              : 0;
          const { inputTokens, cacheableTokens } = gen.breakdown;
          const cacheShare = inputTokens > 0 ? cacheableTokens / inputTokens : 0;
          const selected = gen.index === selectedIndex;
          const lane = lanes.indexOf(gen.name);
          return (
            <button
              type="button"
              key={gen.index}
              onClick={() => onSelect(gen.index)}
              aria-pressed={selected}
              title={`[${gen.index}] ${gen.name} · ${formatSeconds(latency)}${
                timeToFirstToken !== undefined ? `, ttft ${formatSeconds(timeToFirstToken)}` : ""
              }, ${formatPercent(cacheableTokens, inputTokens)} repeated prefix`}
              className={cn(
                "absolute cursor-pointer overflow-hidden border-r border-ta-grey-500",
                selected ? "bg-ta-grey-300/60" : "bg-ta-grey-450 hover:bg-ta-grey-300/40",
              )}
              style={{
                left: `${((starts[gen.index] ?? 0) / total) * 100}%`,
                width: `${(latency / total) * 100}%`,
                top: lane * LANE_H + 3,
                height: LANE_H - 6,
              }}
            >
              <span
                className="absolute inset-y-0 left-0 bg-ta-grey-500/60"
                style={{ width: `${ttftShare * 100}%` }}
              />
              <span className="absolute inset-x-0 bottom-0 h-1 bg-ta-orange-300">
                <span
                  className="absolute inset-y-0 left-0 bg-ta-grey-300"
                  style={{ width: `${cacheShare * 100}%` }}
                />
              </span>
              <span
                className={cn(
                  "type-accent-s absolute left-1 top-0.5",
                  selected ? "text-ta-sand-50" : "text-ta-grey-200",
                )}
              >
                {gen.index}
              </span>
            </button>
          );
        })}
        <span
          className="pointer-events-none absolute top-0 w-0.5 bg-ta-sand-50"
          style={{ left: `${(replay.elapsed / total) * 100}%`, height: plotHeight }}
        />
      </div>
    </div>
  );
}

/** A tick spacing that lands on 1/2/5/10/15/30/60-style steps, aiming for ~8 ticks. */
function tickStep(total: number): number {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const target = total / 8;
  return candidates.find((c) => c >= target) ?? 3600;
}
