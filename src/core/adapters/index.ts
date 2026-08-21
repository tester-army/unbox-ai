import type { RawTrace } from "../types";
import type { TraceAdapter } from "./adapter";
import { gatewayAdapter } from "./gateway";
import { opencodeAdapter } from "./opencode";

export type { TraceAdapter } from "./adapter";

/** Most specific detection first; gateway last - it is the internal shape itself. */
export const ADAPTERS: TraceAdapter[] = [
  opencodeAdapter as TraceAdapter,
  gatewayAdapter as TraceAdapter,
];

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
