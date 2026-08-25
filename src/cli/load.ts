import { readFileSync } from "node:fs";
import { resolveAdapter } from "../core/adapters";
import { parseCollection, type TraceCollectionItem } from "../core/collection";
import { normalizeTrace } from "../core/normalize";
import type { NormalizedTrace, RawTrace } from "../core/types";

export interface LoadedTrace {
  path: string;
  /** Which adapter recognized the file, e.g. "gateway" or "opencode". */
  format: string;
  raw: RawTrace;
  trace: NormalizedTrace;
}

/** Reads, parses, and normalizes a trace file, exiting with a readable error on failure. */
export function loadTrace(path: string): LoadedTrace {
  const json = readJson(path);
  try {
    // adapters (e.g. opencode) synthesize the internal raw shape; `get`
    // pointers resolve against that adapted form. Multi-run sources are
    // merged here - the text commands speak one trace
    const adapter = resolveAdapter(json);
    const raw = adapter.adapt(json);
    return { path, format: adapter.name, raw, trace: normalizeTrace(raw) };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Loads one trace per independent run across the given files - a devtools
 * database splits per root run, and several files concatenate.
 */
export function loadCollectionFiles(paths: string[]): TraceCollectionItem[] {
  try {
    return paths.flatMap((path) => parseCollection(readJson(path)).items);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** Loads one run of a multi-run source, selected by `runs` index or trace id. */
export function loadRun(path: string, selector: string): LoadedTrace {
  const json = readJson(path);
  try {
    const { format, items } = parseCollection(json);
    const item = /^\d+$/.test(selector)
      ? items[Number(selector)]
      : items.find(({ trace }) => trace.traceId === selector);
    if (!item) {
      throw new Error(`No run "${selector}" (${items.length} runs). List them: unbox-ai runs ${path}`);
    }
    return { path, format, raw: item.raw, trace: item.trace };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`Cannot read file: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`Not valid JSON: ${path}`);
  }
}

export function fail(message: string): never {
  console.error(`unbox-ai: ${message}`);
  process.exit(1);
}
