import { useState } from "react";
import { GenerationDetail } from "@/components/GenerationDetail";
import { Header } from "@/components/Header";
import { ReplayBar } from "@/components/ReplayBar";
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
  trace: NonNullable<ReturnType<typeof useTrace>["trace"]>;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function Loaded({ trace, selectedIndex, onSelect }: LoadedProps) {
  const replay = useReplay(trace, onSelect);
  const selected = trace.generations[selectedIndex] ?? trace.generations[0];
  if (!selected) {
    return (
      <Shell>
        <p className="type-body-m p-8 text-ta-error">Trace has no generations.</p>
      </Shell>
    );
  }

  // a manual pick pauses the replay so it does not fight the user
  const selectManually = (index: number) => {
    replay.pause();
    onSelect(index);
  };

  return (
    <Shell>
      <Header trace={trace} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-100 shrink-0 overflow-y-auto border-r border-ta-grey-400">
          <Waterfall
            trace={trace}
            selectedIndex={selected.index}
            onSelect={selectManually}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <ReplayBar
            trace={trace}
            replay={replay}
            selectedIndex={selected.index}
            onSelect={onSelect}
          />
          <TreemapSection trace={trace} generation={selected} />
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
