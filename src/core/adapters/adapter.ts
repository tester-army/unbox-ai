import type { RawTrace } from "../types";

/**
 * A trace format adapter: recognizes its format and converts it to the
 * internal raw shape (cumulative-snapshot events) everything else consumes.
 *
 * To add a format: create src/core/adapters/<name>.ts exporting a
 * TraceAdapter, and register it in src/core/adapters/index.ts. Order
 * matters - most specific detection first; gateway last since it is the
 * internal shape itself. `adapt` may throw with a readable message for
 * near-misses.
 */
export interface TraceAdapter<T = unknown> {
  /** Format id, shown in errors and `summary` output. */
  name: string;
  detect(json: unknown): json is T;
  adapt(json: T): RawTrace;
  /**
   * Splits a source that holds several independent traces (e.g. one per
   * devtools run) into parts, each fed to adapt(). Absent for single-trace
   * formats. May return zero parts when the source is empty.
   */
  split?(json: T): T[];
}
