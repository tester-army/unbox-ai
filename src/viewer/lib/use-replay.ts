import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedTrace } from "@core/types";

export interface Replay {
  playing: boolean;
  speed: number;
  /** Model-time seconds elapsed on the replay clock. */
  elapsed: number;
  total: number;
  /** Generation the playhead is currently inside. */
  currentIndex: number;
  toggle: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  /** Jumps the clock to a generation's start without changing play state. */
  seekToGeneration: (index: number) => void;
}

/**
 * Replays the trace on a model-time clock: latencies play back at a chosen
 * speed and the entered generation is reported so the UI can follow along.
 */
export function useReplay(
  trace: NormalizedTrace,
  onGenerationEnter: (index: number) => void,
): Replay {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [elapsed, setElapsed] = useState(0);

  // start offset of each generation on the model-time axis
  const starts = useMemo(() => {
    const acc: number[] = [];
    let t = 0;
    for (const gen of trace.generations) {
      acc.push(t);
      t += gen.metrics.latency;
    }
    return acc;
  }, [trace]);
  const total = trace.totalLatency;

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

  // follow the playhead: select each generation as the clock enters it
  const enter = useRef(onGenerationEnter);
  enter.current = onGenerationEnter;
  useEffect(() => {
    if (playing) enter.current(currentIndex);
  }, [playing, currentIndex]);

  return {
    playing,
    speed,
    elapsed,
    total,
    currentIndex,
    toggle: () => {
      if (!playing && elapsed >= total) setElapsed(0);
      setPlaying((p) => !p);
    },
    pause: () => setPlaying(false),
    setSpeed,
    seekToGeneration: (index) => setElapsed(starts[index] ?? 0),
  };
}
