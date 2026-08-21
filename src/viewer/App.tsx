import { useState } from "react";
import { GenerationDetail } from "@/components/GenerationDetail";
import { Header } from "@/components/Header";
import { TreemapSection } from "@/components/TreemapSection";
import { Waterfall } from "@/components/Waterfall";
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

  const selected = trace.generations[selectedIndex] ?? trace.generations[0];
  if (!selected) {
    return (
      <Shell>
        <p className="type-body-m p-8 text-ta-error">Trace has no generations.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header trace={trace} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-100 shrink-0 overflow-y-auto border-r border-ta-grey-400">
          <Waterfall
            trace={trace}
            selectedIndex={selected.index}
            onSelect={setSelectedIndex}
          />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
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
