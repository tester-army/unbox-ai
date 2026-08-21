import { lazy, Suspense, useEffect, useState } from "react";
import type { NormalizedTrace } from "@core/types";
import { GenerationDetail } from "@/components/GenerationDetail";
import { Header } from "@/components/Header";

// recharts is the heaviest dependency; keep it out of the initial chunk
const InsightsSection = lazy(() =>
  import("@/components/InsightsSection").then((m) => ({ default: m.InsightsSection })),
);
import { ReplayBar } from "@/components/ReplayBar";
import { ToolCallsSection } from "@/components/ToolCallsSection";
import { TreemapSection } from "@/components/TreemapSection";
import { Waterfall } from "@/components/Waterfall";
import { useReplay } from "@/lib/use-replay";
import { useTrace } from "@/lib/use-trace";

export function App() {
  const { trace, error } = useTrace();
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (error) {
    return (
      <Shell>
        <p className="type-body-m p-8 text-ta-error">Failed to load trace: {error}</p>
      </Shell>
    );
  }
  if (!trace) {
    return (
      <Shell>
        <p className="type-accent-m p-8 text-ta-grey-200">loading trace...</p>
      </Shell>
    );
  }

  return <Loaded trace={trace} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />;
}

interface LoadedProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function Loaded({ trace, selectedIndex, onSelect }: LoadedProps) {
  const replay = useReplay(trace);

  // follow the playhead: the entered generation becomes the selection
  useEffect(() => {
    if (replay.playing) onSelect(replay.currentIndex);
  }, [replay.playing, replay.currentIndex, onSelect]);

  const selected = trace.generations[selectedIndex] ?? trace.generations[0];
  if (!selected) {
    return (
      <Shell>
        <p className="type-body-m p-8 text-ta-error">Trace has no generations.</p>
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
      <Header trace={trace} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-ta-grey-400">
          <Waterfall
            trace={trace}
            selectedIndex={selected.index}
            onSelect={selectGeneration}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <ReplayBar
            trace={trace}
            replay={replay}
            selectedIndex={selected.index}
            onSelect={selectGeneration}
          />
          <TreemapSection trace={trace} generation={selected} />
          <ToolCallsSection
            trace={trace}
            selectedIndex={selected.index}
            onSelect={selectGeneration}
          />
          <Suspense fallback={null}>
            <InsightsSection trace={trace} onSelect={selectGeneration} />
          </Suspense>
          <GenerationDetail key={selected.index} generation={selected} />
        </main>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ta-landing flex h-screen flex-col bg-ta-grey-500 text-ta-sand-50">
      {children}
    </div>
  );
}
