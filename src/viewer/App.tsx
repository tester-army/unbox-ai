import type { RunSummary } from "@core/collection";
import type { NormalizedTrace } from "@core/types";
import { useEffect, useRef, useState } from "react";
import { CompareView } from "@/components/CompareView";
import { GenerationDetail } from "@/components/GenerationDetail";
import { Header } from "@/components/Header";
import { ReplayBar } from "@/components/ReplayBar";
import { RunList } from "@/components/RunList";
import { OpenButton, SourceTabs, sourceTabs } from "@/components/SourceTabs";
import { ToolCallsSection } from "@/components/ToolCallsSection";
import { TreemapSection } from "@/components/TreemapSection";
import { CopyButton } from "@/components/ui/copy-button";
import { Waterfall } from "@/components/Waterfall";
import { useReplay } from "@/lib/use-replay";
import { useTrace } from "@/lib/use-trace";
import { cn } from "@/lib/utils";

export function App() {
  const {
    runs,
    trace,
    error,
    live,
    selectedRun,
    selectRun,
    command,
    openFiles,
    closeSource,
    openError,
  } = useTrace();
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
    if (!live && runs?.length === 0) {
      return (
        <Shell {...dropHandlers(openFiles)}>
          <NoOpenTraces onOpen={openFiles} openError={openError} />
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
      agentCommand={command}
      openFiles={openFiles}
      closeSource={closeSource}
      openError={openError}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
    />
  );
}

/** Static mode accepts trace files dropped anywhere in the window. */
function dropHandlers(openFiles: (files: Iterable<File>) => void) {
  return {
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) openFiles(e.dataTransfer.files);
    },
  };
}

interface LoadedProps {
  trace: NormalizedTrace;
  runs: RunSummary[];
  selectedRun?: string;
  onSelectRun: (id: string) => void;
  live: boolean;
  agentCommand?: string;
  openFiles: (files: Iterable<File>) => void;
  closeSource: (source: string) => void;
  openError?: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function Loaded({
  trace,
  runs,
  selectedRun,
  onSelectRun,
  live,
  agentCommand,
  openFiles,
  closeSource,
  openError,
  selectedIndex,
  onSelect,
}: LoadedProps) {
  const replay = useReplay(trace);
  const [comparing, setComparing] = useState(false);

  // several opened files become tabs; devtools' live feed stays a plain list
  const tabs = live ? [] : sourceTabs(runs);
  const selectedSource = runs.find((run) => run.id === selectedRun)?.source;
  const scopedRuns = tabs.length > 0 ? runs.filter((run) => run.source === selectedSource) : runs;

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
        {live ? (
          <WaitingForCalls />
        ) : (
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
    <Shell {...(live ? {} : dropHandlers(openFiles))}>
      <Header
        trace={trace}
        agentCommand={agentCommand}
        onCompare={runs.length > 1 ? () => setComparing((v) => !v) : undefined}
        comparing={comparing}
        onClear={live ? () => void fetch("/api/clear", { method: "POST" }) : undefined}
      />
      {comparing && (
        <CompareView
          runs={runs}
          initialA={selectedRun ?? trace.traceId}
          onClose={() => setComparing(false)}
        />
      )}
      {!comparing && tabs.length > 0 && (
        <SourceTabs
          tabs={tabs}
          selectedSource={selectedSource}
          onSelect={(tab) => onSelectRun(tab.runs.at(-1)!.id)}
          onClose={closeSource}
          onOpen={openFiles}
          openError={openError}
        />
      )}
      <div className={cn("flex min-h-0 flex-1", comparing && "hidden")}>
        {/* stable gutters: a scrollbar appearing mid-stream must not shift the layout */}
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-ta-grey-400 [scrollbar-gutter:stable]">
          {scopedRuns.length > 1 && (
            <RunList runs={scopedRuns} selectedId={selectedRun} onSelect={onSelectRun} />
          )}
          <Waterfall trace={trace} selectedIndex={selected.index} onSelect={selectGeneration} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
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

const REGISTER_SNIPPET = `import { registerTelemetry } from "ai";
import { DevToolsTelemetry } from "@ai-sdk/devtools";

registerTelemetry(DevToolsTelemetry());`;

function WaitingForCalls() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl border border-ta-grey-400 bg-ta-grey-450">
        <div className="flex items-center gap-3 border-b border-ta-grey-400 px-5 py-3">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-ta-orange-300" />
          <p className="type-accent-m text-ta-sand-50">waiting for AI SDK calls</p>
          <p className="type-accent-s ml-auto text-ta-grey-300">{location.host}</p>
        </div>
        <div className="flex flex-col gap-5 px-5 py-5">
          <SetupStep n={1} label="install">
            <Snippet text="npm install @ai-sdk/devtools" />
          </SetupStep>
          <SetupStep n={2} label="register once at startup">
            <Snippet text={REGISTER_SNIPPET} />
          </SetupStep>
          <p className="type-body-s text-ta-grey-200">
            Every generateText / streamText call then appears here live. Runs persist in{" "}
            <span className="font-(family-name:--font-dm-mono)">.devtools/generations.json</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function SetupStep({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-accent-s text-ta-grey-200">
        <span className="text-ta-orange-300">{n}</span> · {label}
      </p>
      {children}
    </div>
  );
}

function Snippet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 border border-ta-grey-400 bg-ta-grey-500 py-2 pl-4 pr-2">
      <pre className="type-body-s min-w-0 flex-1 overflow-x-auto py-1 font-(family-name:--font-dm-mono) leading-relaxed text-ta-grey-100">
        {text}
      </pre>
      <CopyButton className="border-none" text={text} />
    </div>
  );
}

function NoOpenTraces({
  onOpen,
  openError,
}: {
  onOpen: (files: Iterable<File>) => void;
  openError?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-md flex-col items-center gap-4 border border-ta-grey-400 bg-ta-grey-450 px-8 py-10">
        <p className="type-accent-m text-ta-sand-50">no open traces</p>
        <OpenButton onOpen={onOpen}>open trace file</OpenButton>
        <p className="type-body-s text-ta-grey-200">or drop a .json anywhere in this window</p>
        {openError && <p className="type-accent-s text-ta-error">{openError}</p>}
      </div>
    </div>
  );
}

function Shell({ children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className="ta-landing flex h-screen flex-col bg-ta-grey-500 text-ta-sand-50" {...props}>
      {children}
    </div>
  );
}
