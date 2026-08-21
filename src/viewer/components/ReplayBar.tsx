import type { NormalizedTrace } from "@core/types";
import { formatPercent, formatSeconds } from "@core/format";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SPEEDS, type Replay } from "@/lib/use-replay";
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

  return (
    <section className="border-b border-ta-grey-400">
      <div className="flex items-center gap-4 px-6 py-3">
        <h2 className="type-accent-m text-ta-sand-50">time</h2>
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
        <span className="type-accent-s text-ta-grey-100">
          {formatSeconds(replay.elapsed)} / {formatSeconds(total)} model time
        </span>
        <span className="type-accent-s ml-auto text-ta-grey-200">
          dark left of a block = waiting for first token · bottom strip: grey = repeated
          prefix (cache-eligible), orange = fresh
        </span>
      </div>
      <div className="px-6 pb-4">
        {total <= 0 ? (
          <p className="type-accent-s border border-ta-grey-400 px-3 py-2 text-ta-grey-200">
            no latency data in this trace
          </p>
        ) : (
          <div className="relative h-16 w-full border border-ta-grey-400 bg-ta-grey-500">
            {trace.generations.map((gen) => {
              const { latency, timeToFirstToken } = gen.metrics;
              const ttftShare = latency > 0 ? Math.min(timeToFirstToken / latency, 1) : 0;
              const { inputTokens, cacheableTokens } = gen.breakdown;
              const cacheShare = inputTokens > 0 ? cacheableTokens / inputTokens : 0;
              const selected = gen.index === selectedIndex;
              return (
                <button
                  key={gen.index}
                  onClick={() => onSelect(gen.index)}
                  aria-pressed={selected}
                  title={`[${gen.index}] ${formatSeconds(latency)}, ttft ${formatSeconds(
                    timeToFirstToken,
                  )}, ${formatPercent(cacheableTokens, inputTokens)} repeated prefix`}
                  className={cn(
                    "absolute inset-y-0 cursor-pointer overflow-hidden border-r border-ta-grey-500",
                    selected ? "bg-ta-grey-300/60" : "bg-ta-grey-450 hover:bg-ta-grey-300/40",
                  )}
                  style={{
                    left: `${((starts[gen.index] ?? 0) / total) * 100}%`,
                    width: `${(latency / total) * 100}%`,
                  }}
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-ta-grey-500/60"
                    style={{ width: `${ttftShare * 100}%` }}
                  />
                  <span className="absolute inset-x-0 bottom-0 h-1.5 bg-ta-orange-300">
                    <span
                      className="absolute inset-y-0 left-0 bg-ta-grey-300"
                      style={{ width: `${cacheShare * 100}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "type-accent-s absolute left-1 top-1",
                      selected ? "text-ta-sand-50" : "text-ta-grey-200",
                    )}
                  >
                    {gen.index}
                  </span>
                </button>
              );
            })}
            <span
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-ta-sand-50"
              style={{ left: `${(replay.elapsed / total) * 100}%` }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
