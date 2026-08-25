import type { Generation, NormalizedTrace } from "@core/types";
import { useEffect, useMemo, useState } from "react";

export const SPEEDS = [1, 4, 8];

/** Reported execution time of a generation's tool calls, in seconds. */
export function toolSeconds(gen: Generation): number {
  return (
    gen.newMessages
      .flatMap((m) => m.toolCalls ?? [])
      .reduce((acc, call) => acc + (call.durationMs ?? 0), 0) / 1000
  );
}

export interface Replay {
  playing: boolean;
  speed: number;
  /** Model-time seconds elapsed on the replay clock. */
  elapsed: number;
  total: number;
  /** Start offset of each generation on the model-time axis. */
  starts: number[];
  /** Generation the playhead is currently inside. */
  currentIndex: number;
  toggle: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  /** Jumps the clock to an arbitrary point, clamped to [0, total]. */
  seek: (seconds: number) => void;
  /** Jumps the clock to a generation's start without changing play state. */
  seekToGeneration: (index: number) => void;
}

/**
 * Replays the trace on a model-time clock: latencies play back at a chosen
 * speed. Callers follow the playhead by watching currentIndex while playing.
 */
export function useReplay(trace: NormalizedTrace): Replay {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1]!);
  const [elapsed, setElapsed] = useState(0);

  // the axis is model time plus KNOWN tool execution time: each generation
  // is followed by its calls' reported durations, so a 10s wait_for takes
  // 10s of timeline (traces without durations collapse to pure model time)
  const { starts, total } = useMemo(() => {
    const acc: number[] = [];
    let t = 0;
    for (const gen of trace.generations) {
      acc.push(t);
      t += gen.metrics.latency + toolSeconds(gen);
    }
    return { starts: acc, total: t };
  }, [trace]);

  const currentIndex = Math.max(
    0,
    starts.findLastIndex((start) => start <= elapsed),
  );

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = ((now - last) / 1000) * speed;
      last = now;
      setElapsed((e) => Math.min(e + delta, total));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total]);

  useEffect(() => {
    if (playing && elapsed >= total) setPlaying(false);
  }, [playing, elapsed, total]);

  return {
    playing,
    speed,
    elapsed,
    total,
    starts,
    currentIndex,
    toggle: () => {
      if (!playing && elapsed >= total) setElapsed(0);
      setPlaying((p) => !p);
    },
    pause: () => setPlaying(false),
    setSpeed,
    seek: (seconds) => setElapsed(Math.min(Math.max(seconds, 0), total)),
    seekToGeneration: (index) => setElapsed(starts[index] ?? 0),
  };
}
