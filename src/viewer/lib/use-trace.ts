import { useEffect, useState } from "react";
import type { NormalizedTrace } from "@core/types";

interface TraceState {
  trace?: NormalizedTrace;
  error?: string;
}

/** Loads the normalized trace the CLI server exposes at /api/trace. */
export function useTrace(): TraceState {
  const [state, setState] = useState<TraceState>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/trace")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((trace) => !cancelled && setState({ trace }))
      .catch((error) => !cancelled && setState({ error: String(error) }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
