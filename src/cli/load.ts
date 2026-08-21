import { readFileSync } from "node:fs";
import { normalizeTrace, parseTrace } from "../core/normalize";
import type { NormalizedTrace, RawTrace } from "../core/types";

export interface LoadedTrace {
  path: string;
  raw: RawTrace;
  trace: NormalizedTrace;
}

/** Reads, parses, and normalizes a trace file, exiting with a readable error on failure. */
export function loadTrace(path: string): LoadedTrace {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`Cannot read file: ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    fail(`Not valid JSON: ${path}`);
  }
  try {
    // adapters (e.g. opencode) synthesize the internal raw shape; `get`
    // pointers resolve against that adapted form
    const raw: RawTrace = parseTrace(json);
    return { path, raw, trace: normalizeTrace(raw) };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function fail(message: string): never {
  console.error(`unbox-ai: ${message}`);
  process.exit(1);
}
