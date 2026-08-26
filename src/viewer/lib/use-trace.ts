import {
  parseCollection,
  type RunSummary,
  runSummaries,
  type TraceCollectionItem,
} from "@core/collection";
import type { NormalizedTrace, RawTrace } from "@core/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface TraceState {
  /** One entry per independent run, chronological; absent until loaded. */
  runs?: RunSummary[];
  trace?: NormalizedTrace;
  selectedRun?: string;
  /** Copyable shell command for an agent to explore the selected run. */
  command?: string;
  error?: string;
  /** Last failure opening a picked/dropped file; cleared on the next attempt. */
  openError?: string;
  /** True when the server pushes updates (unbox-ai devtools mode). */
  live: boolean;
}

/** Raw traces of browser-opened files; stands in for /api/raw on their runs. */
const localRaws = new Map<string, RawTrace>();

/** The raw trace behind a browser-opened run, or undefined for server runs. */
export function localRawTrace(traceId: string): RawTrace | undefined {
  return localRaws.get(traceId);
}

/**
 * Loads the run list (/api/traces) and the selected run's trace
 * (/api/trace?id=...), refetching both on every /api/events update push.
 * Follows the newest run until the user picks an older one; the browser
 * reconnects the event stream by itself after server restarts.
 *
 * Files opened in the browser (openFiles) are parsed locally and merged into
 * the run list; closed sources (closeSource) are hidden. Both last until the
 * page reloads.
 */
export function useTrace(): TraceState & {
  selectRun: (id: string) => void;
  openFiles: (files: Iterable<File>) => void;
  closeSource: (source: string) => void;
} {
  const [state, setState] = useState<TraceState>({ live: false });
  const selectedRef = useRef<string | undefined>(undefined);
  const pinnedRef = useRef(false);
  const seqRef = useRef(0);
  const loadRef = useRef(() => {});
  const localItemsRef = useRef<TraceCollectionItem[]>([]);
  const closedRef = useRef(new Set<string>());
  const runsRef = useRef<RunSummary[]>([]);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const serverRuns = (await fetchJson("/api/traces")) as RunSummary[];
      const runs = [...serverRuns, ...runSummaries(localItemsRef.current)].filter(
        (run) => run.source === undefined || !closedRef.current.has(run.source),
      );
      const latest = defaultRun(runs);
      let selected = selectedRef.current;
      if (
        selected === undefined ||
        !runs.some((run) => run.id === selected) ||
        (!pinnedRef.current && selected !== latest)
      ) {
        selected = latest;
        pinnedRef.current = false;
      }
      selectedRef.current = selected;
      const local = localItemsRef.current.find((item) => item.trace.traceId === selected);
      const [trace, command] =
        selected === undefined
          ? [undefined, undefined]
          : local
            ? [local.trace, undefined]
            : await Promise.all([
                fetchJson(
                  `/api/trace?id=${encodeURIComponent(selected)}`,
                ) as Promise<NormalizedTrace>,
                fetchCommand(selected),
              ]);
      // update bursts overlap; only the newest request may win
      if (seq !== seqRef.current) return;
      runsRef.current = runs;
      setState((prev) => ({
        ...prev,
        runs,
        trace,
        command,
        selectedRun: selected,
        error: undefined,
      }));
    } catch (error) {
      if (seq !== seqRef.current) return;
      // a transient refetch failure must not blank an already-loaded trace
      setState((prev) => (prev.trace ? prev : { ...prev, error: String(error) }));
    }
  }, []);
  loadRef.current = load;

  useEffect(() => {
    load();
    const events = new EventSource("/api/events");
    events.addEventListener("hello", (e) => {
      const live = (JSON.parse(e.data) as { live?: boolean }).live === true;
      setState((prev) => ({ ...prev, live }));
    });
    events.addEventListener("update", () => loadRef.current());
    return () => {
      seqRef.current++;
      events.close();
    };
  }, [load]);

  const selectRun = useCallback(
    (id: string) => {
      selectedRef.current = id;
      // picking anything but the follow target pins it; load() re-derives the
      // target, so the comparison must use the same defaultRun
      pinnedRef.current = id !== defaultRun(runsRef.current);
      load();
    },
    [load],
  );

  const openFiles = useCallback((files: Iterable<File>) => {
    void (async () => {
      let lastOpened: TraceCollectionItem | undefined;
      let failure: string | undefined;
      for (const file of files) {
        try {
          const items = parseCollection(JSON.parse(await file.text())).items;
          if (items.length === 0) throw new Error("no runs");
          const adopted = adoptItems(items, uniqueSource(file.name, takenSources()), takenIds());
          localItemsRef.current = [...localItemsRef.current, ...adopted];
          lastOpened = adopted.at(-1);
        } catch {
          failure = `${file.name}: not a readable trace`;
        }
      }
      if (lastOpened !== undefined) {
        selectedRef.current = lastOpened.trace.traceId;
        pinnedRef.current = true;
      }
      setState((prev) => ({ ...prev, openError: failure }));
      loadRef.current();
    })();

    function takenSources(): Set<string> {
      const taken = new Set(closedRef.current);
      for (const run of runsRef.current) if (run.source !== undefined) taken.add(run.source);
      for (const item of localItemsRef.current) taken.add(item.sourcePath!);
      return taken;
    }
    function takenIds(): Set<string> {
      const taken = new Set(runsRef.current.map((run) => run.id));
      for (const item of localItemsRef.current) taken.add(item.trace.traceId);
      return taken;
    }
  }, []);

  const closeSource = useCallback((source: string) => {
    const runs = runsRef.current;
    const order = [...new Set(runs.map((run) => run.source))].filter(
      (s): s is string => s !== undefined,
    );
    closedRef.current.add(source);
    for (const item of localItemsRef.current) {
      if (item.sourcePath === source) localRaws.delete(item.trace.traceId);
    }
    localItemsRef.current = localItemsRef.current.filter((item) => item.sourcePath !== source);
    // closing the active tab activates its right neighbor, else the left one
    if (runs.find((run) => run.id === selectedRef.current)?.source === source) {
      const index = order.indexOf(source);
      const next = order[index + 1] ?? order[index - 1];
      const target =
        next !== undefined ? runs.filter((run) => run.source === next).at(-1) : undefined;
      selectedRef.current = target?.id;
      pinnedRef.current = target !== undefined;
    }
    loadRef.current();
  }, []);

  return { ...state, selectRun, openFiles, closeSource };
}

/**
 * Several opened files start on the first file's newest run - tabs read left
 * to right. A single source (live devtools included) follows its newest run.
 */
function defaultRun(runs: RunSummary[]): string | undefined {
  const first = runs[0];
  if (first?.source === undefined) return runs.at(-1)?.id;
  const sameSource = runs.filter((run) => run.source === first.source);
  return sameSource.length === runs.length ? runs.at(-1)?.id : sameSource.at(-1)?.id;
}

/** The dropped file's name, counted up when a tab by that name already exists. */
function uniqueSource(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
}

/**
 * Tags parsed runs with their tab source and de-collides run ids against
 * already-listed ones (reopening a served file), keeping parent links whole.
 */
function adoptItems(
  items: TraceCollectionItem[],
  source: string,
  takenIds: Set<string>,
): TraceCollectionItem[] {
  const rename = new Map<string, string>();
  for (const { trace } of items) {
    let id = trace.traceId;
    if (takenIds.has(id)) {
      let n = 2;
      while (takenIds.has(`${id} (${n})`)) n++;
      id = `${id} (${n})`;
      rename.set(trace.traceId, id);
    }
    takenIds.add(id);
  }
  return items.map((item) => {
    const trace = {
      ...item.trace,
      traceId: rename.get(item.trace.traceId) ?? item.trace.traceId,
      parentTraceId:
        item.trace.parentTraceId !== undefined
          ? (rename.get(item.trace.parentTraceId) ?? item.trace.parentTraceId)
          : undefined,
    };
    localRaws.set(trace.traceId, item.raw);
    return { raw: item.raw, trace, sourcePath: source };
  });
}

/** Sources without a file path (or older servers) have no command; not an error. */
async function fetchCommand(id: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/api/command?id=${encodeURIComponent(id)}`);
    if (!res.ok) return undefined;
    return ((await res.json()) as { command: string }).command;
  } catch {
    return undefined;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
  return res.json();
}
