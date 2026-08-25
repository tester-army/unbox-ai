import type { RunSummary } from "@core/collection";
import type { NormalizedTrace } from "@core/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface TraceState {
  /** One entry per independent run, chronological; absent until loaded. */
  runs?: RunSummary[];
  trace?: NormalizedTrace;
  selectedRun?: string;
  error?: string;
  /** True when the server pushes updates (unbox-ai devtools mode). */
  live: boolean;
}

/**
 * Loads the run list (/api/traces) and the selected run's trace
 * (/api/trace?id=...), refetching both on every /api/events update push.
 * Follows the newest run until the user picks an older one; the browser
 * reconnects the event stream by itself after server restarts.
 */
export function useTrace(): TraceState & { selectRun: (id: string) => void } {
  const [state, setState] = useState<TraceState>({ live: false });
  const selectedRef = useRef<string | undefined>(undefined);
  const pinnedRef = useRef(false);
  const seqRef = useRef(0);
  const loadRef = useRef(() => {});

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const runs = (await fetchJson("/api/traces")) as RunSummary[];
      const latest = runs.at(-1)?.id;
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
      const trace =
        selected === undefined
          ? undefined
          : ((await fetchJson(`/api/trace?id=${encodeURIComponent(selected)}`)) as NormalizedTrace);
      // update bursts overlap; only the newest request may win
      if (seq !== seqRef.current) return;
      setState((prev) => ({ ...prev, runs, trace, selectedRun: selected, error: undefined }));
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
      // picking an older run pins it; picking the newest resumes following
      pinnedRef.current = id !== state.runs?.at(-1)?.id;
      load();
    },
    [load, state.runs],
  );

  return { ...state, selectRun };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
  return res.json();
}
