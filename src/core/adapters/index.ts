import type { RawTrace } from "../types";
import { gatewayAdapter } from "./gateway";
import { opencodeAdapter } from "./opencode";

/**
 * A trace format adapter: recognizes its format and converts it to the
 * internal raw shape (cumulative-snapshot events) everything else consumes.
 *
 * To add a format: create src/core/adapters/<name>.ts exporting a
 * TraceAdapter, and register it here. Order matters - most specific
 * detection first; gateway last since it is the internal shape itself.
 * `adapt` may throw with a readable message for near-misses.
 */
export interface TraceAdapter {
  /** Format id, shown in errors and `summary` output. */
  name: string;
  detect(json: unknown): boolean;
  adapt(json: unknown): RawTrace;
}

export const ADAPTERS: TraceAdapter[] = [opencodeAdapter, gatewayAdapter];

/** Finds the adapter that recognizes this JSON, or throws listing known formats. */
export function resolveAdapter(json: unknown): TraceAdapter {
  const adapter = ADAPTERS.find((a) => a.detect(json));
  if (!adapter) {
    throw new Error(
      `Unsupported trace format. Known formats: ${ADAPTERS.map((a) => a.name).join(", ")}`,
    );
  }
  return adapter;
}

/** Parses any supported trace JSON into the internal raw shape. */
export function parseTrace(json: unknown): RawTrace {
  return resolveAdapter(json).adapt(json);
}
