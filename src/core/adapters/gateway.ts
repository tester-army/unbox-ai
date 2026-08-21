import { assertTraceShape } from "../normalize";
import type { RawTrace } from "../types";
import type { TraceAdapter } from "./index";

/**
 * Gateway exports ARE the internal shape ({events[]} of generation entries
 * with cumulative message snapshots), so this adapter only validates.
 */
export const gatewayAdapter: TraceAdapter = {
  name: "gateway",
  detect(json: unknown): boolean {
    return (
      typeof json === "object" && json !== null && Array.isArray((json as RawTrace).events)
    );
  },
  adapt(json: unknown): RawTrace {
    assertTraceShape(json);
    return json;
  },
};
