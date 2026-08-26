import type { RunSummary } from "@core/collection";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { basename, cn, pathSegments } from "@/lib/utils";

export interface SourceTab {
  /** Absolute path (server files) or file name (browser-opened); the grouping key. */
  source: string;
  label: string;
  runs: RunSummary[];
}

/**
 * Groups runs into one tab per source file, in first-seen order. Any run
 * without a source hides the tabs - partial grouping would drop runs.
 */
export function sourceTabs(runs: RunSummary[]): SourceTab[] {
  const bySource = new Map<string, RunSummary[]>();
  for (const run of runs) {
    if (run.source === undefined) return [];
    const group = bySource.get(run.source);
    if (group) group.push(run);
    else bySource.set(run.source, [run]);
  }
  const sources = [...bySource.keys()];
  const labels = disambiguate(sources);
  return sources.map((source) => ({
    source,
    label: labels.get(source)!,
    runs: bySource.get(source)!,
  }));
}

/** Basenames, widened to parent/basename when two files share a name. */
function disambiguate(sources: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(basename(source), (counts.get(basename(source)) ?? 0) + 1);
  }
  return new Map(
    sources.map((source) => [
      source,
      counts.get(basename(source))! > 1
        ? pathSegments(source).slice(-2).join("/")
        : basename(source),
    ]),
  );
}

interface SourceTabsProps {
  tabs: SourceTab[];
  selectedSource?: string;
  onSelect: (tab: SourceTab) => void;
  onClose: (source: string) => void;
  onOpen: (files: Iterable<File>) => void;
  /** Last file that failed to open, shown at the end of the strip. */
  openError?: string;
}

/** One tab per opened trace file; the sidebar run list scopes to the active one. */
export function SourceTabs({
  tabs,
  selectedSource,
  onSelect,
  onClose,
  onOpen,
  openError,
}: SourceTabsProps) {
  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-b border-ta-grey-400">
      {tabs.map((tab) => {
        const selected = tab.source === selectedSource;
        return (
          <div
            key={tab.source}
            className={cn(
              "group relative flex shrink-0 items-stretch border-r border-ta-grey-400 transition-colors",
              selected
                ? "bg-ta-grey-450 text-ta-sand-50"
                : "text-ta-grey-200 hover:bg-ta-grey-450/40 hover:text-ta-grey-100",
            )}
          >
            {selected && (
              <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-ta-orange-300" />
            )}
            <button
              type="button"
              onClick={() => onSelect(tab)}
              aria-pressed={selected}
              title={tab.source}
              className="type-accent-s flex cursor-pointer items-center gap-2 py-2.5 pl-4"
            >
              <span className="max-w-48 truncate">{tab.label}</span>
              {tab.runs.length > 1 && (
                <span className={selected ? "text-ta-grey-200" : "text-ta-grey-300"}>
                  {tab.runs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.source)}
              aria-label={`close ${tab.label}`}
              className={cn(
                "cursor-pointer px-2.5 text-ta-grey-300 transition-opacity hover:text-ta-sand-50",
                selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              ×
            </button>
          </div>
        );
      })}
      <OpenButton
        onOpen={onOpen}
        title="open trace files (or drop .json anywhere)"
        className="h-auto self-stretch border-0 border-r border-ta-grey-400 px-4 text-ta-grey-200 hover:border-ta-grey-400 hover:bg-ta-grey-450/40 hover:text-ta-sand-50"
      >
        + open
      </OpenButton>
      {openError && (
        <span className="type-accent-s ml-auto truncate px-4 text-ta-error">{openError}</span>
      )}
    </div>
  );
}

/** window.showOpenFilePicker, on browsers that have it (Chromium). */
type FilePicker = (options: {
  multiple: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ getFile(): Promise<File> }[]>;

/** A DS button that picks trace files; opens them without a server. */
export function OpenButton({
  onOpen,
  title,
  className,
  children,
}: {
  onOpen: (files: Iterable<File>) => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = async () => {
    // a file input's `multiple` is ignored by some embedded browsers; the
    // picker API states multi-selection explicitly, so prefer it
    const picker = (window as { showOpenFilePicker?: FilePicker }).showOpenFilePicker;
    if (picker === undefined) {
      inputRef.current?.click();
      return;
    }
    try {
      const handles = await picker({
        multiple: true,
        types: [{ description: "AI traces", accept: { "application/json": [".json"] } }],
      });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      if (files.length > 0) onOpen(files);
    } catch {
      // picker dismissed
    }
  };
  return (
    <>
      <Button title={title} className={className} onClick={() => void open()}>
        {children}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onOpen(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
