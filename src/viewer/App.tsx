import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "@core/collection";
import type { NormalizedTrace } from "@core/types";
import { GenerationDetail } from "@/components/GenerationDetail";
import { Header } from "@/components/Header";
import { ReplayBar } from "@/components/ReplayBar";
import { RunList } from "@/components/RunList";
import { ToolCallsSection } from "@/components/ToolCallsSection";
import { TreemapSection } from "@/components/TreemapSection";
import { Waterfall } from "@/components/Waterfall";
import { useReplay } from "@/lib/use-replay";
import { useTrace } from "@/lib/use-trace";

export function App() {
  const { runs, trace, error, live, selectedRun, selectRun } = useTrace();
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (error) {
    return (
      <Shell>
        <p className="type-body-m p-8 text-ta-error">Failed to load trace: {error}</p>
      </Shell>
    );
  }
  if (!trace) {
    if (live && runs?.length === 0) {
      return (
        <Shell>
          <WaitingForCalls />
        </Shell>
      );
    }
    return (
      <Shell>
        <p className="type-accent-m p-8 text-ta-grey-200">loading trace...</p>
      </Shell>
    );
  }

  return (
    <Loaded
      trace={trace}
      runs={runs ?? []}
      selectedRun={selectedRun}
      onSelectRun={selectRun}
      live={live}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
    />
  );
}

interface LoadedProps {
  trace: NormalizedTrace;
  runs: RunSummary[];
  selectedRun?: string;
  onSelectRun: (id: string) => void;
  live: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function Loaded({
  trace,
  runs,
  selectedRun,
  onSelectRun,
  live,
  selectedIndex,
  onSelect,
}: LoadedProps) {
  const replay = useReplay(trace);

  // follow the playhead: the entered generation becomes the selection
  useEffect(() => {
    if (replay.playing) onSelect(replay.currentIndex);
  }, [replay.playing, replay.currentIndex, onSelect]);

  // run switches restart the selection; within a run, stick to the newest
  // generation while live unless the user browsed away from the tail
  const count = trace.generations.length;
  const prev = useRef({ id: trace.traceId, count });
  useEffect(() => {
    const last = prev.current;
    prev.current = { id: trace.traceId, count };
    if (trace.traceId !== last.id) {
      onSelect(trace.inProgress ? Math.max(count - 1, 0) : 0);
      return;
    }
    if (!live || count <= last.count || replay.playing) return;
    if (selectedIndex >= last.count - 1) onSelect(count - 1);
  }, [trace.traceId, trace.inProgress, count, live, replay.playing, selectedIndex, onSelect]);

  const selected = trace.generations[selectedIndex] ?? trace.generations[0];
  if (!selected) {
    return (
      <Shell>
        {live ? <WaitingForCalls /> : (
          <p className="type-body-m p-8 text-ta-error">Trace has no generations.</p>
        )}
      </Shell>
    );
  }

  // a manual pick pauses the replay and moves the clock with the selection
  const selectGeneration = (index: number) => {
    replay.pause();
    replay.seekToGeneration(index);
    onSelect(index);
  };

  return (
    <Shell>
      <Header
        trace={trace}
        onClear={live ? () => void fetch("/api/clear", { method: "POST" }) : undefined}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-ta-grey-400">
          {runs.length > 1 && (
            <RunList runs={runs} selectedId={selectedRun} onSelect={onSelectRun} />
          )}
          <Waterfall
            trace={trace}
            selectedIndex={selected.index}
            onSelect={selectGeneration}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {/* context + timeline fill exactly the first viewport; the rest scrolls in */}
          <div className="flex h-full shrink-0 flex-col">
            <TreemapSection trace={trace} generation={selected} />
            <ReplayBar
              trace={trace}
              replay={replay}
              selectedIndex={selected.index}
              onSelect={selectGeneration}
            />
          </div>
          <ToolCallsSection
            trace={trace}
            selectedIndex={selected.index}
            onSelect={selectGeneration}
          />
          <GenerationDetail key={selected.index} trace={trace} generation={selected} />
        </main>
      </div>
    </Shell>
  );
}

function WaitingForCalls() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl border border-ta-grey-400 bg-ta-grey-450">
        <div className="flex items-baseline gap-3 border-b border-ta-grey-400 px-5 py-3">
          <span className="size-2 shrink-0 animate-pulse self-center rounded-full bg-ta-orange-300" />
          <p className="type-accent-m text-ta-sand-50">waiting for AI SDK calls</p>
          <p className="type-accent-s ml-auto text-ta-grey-200">listening on {location.host}</p>
        </div>
        <div className="px-5 py-4">
          <p className="type-body-m text-ta-grey-100">
            Register the devtools telemetry in your app - every generateText / streamText call
            streams in here live.
          </p>
          <pre className="type-body-s mt-4 overflow-x-auto border border-ta-grey-400 bg-ta-grey-500 px-4 py-3 font-(family-name:--font-dm-mono) leading-relaxed text-ta-sand-50">
            {`import { registerTelemetry } from "ai";
import { DevToolsTelemetry } from "@ai-sdk/devtools";

registerTelemetry(DevToolsTelemetry());`}
          </pre>
          <p className="type-accent-s mt-4 text-ta-grey-200">
            npm i @ai-sdk/devtools · runs persist in .devtools/generations.json
          </p>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ta-landing flex h-screen flex-col bg-ta-grey-500 text-ta-sand-50">
      {children}
    </div>
  );
}
