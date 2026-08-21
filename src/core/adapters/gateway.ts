import { assertTraceShape } from "../normalize";
import type { RawTrace } from "../types";
import type { TraceAdapter } from "./adapter";

/**
 * Gateway exports ARE the internal shape ({events[]} of generation entries
 * with cumulative message snapshots), so this adapter only validates.
 */
export const gatewayAdapter: TraceAdapter<RawTrace> = {
  name: "gateway",
  detect(json: unknown): json is RawTrace {
    return (
      typeof json === "object" && json !== null && Array.isArray((json as RawTrace).events)
    );
  },
  adapt(json: RawTrace): RawTrace {
    assertTraceShape(json);
    return json;
  },
};
