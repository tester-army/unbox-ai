import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseCollection } from "../core/collection";
import { buildCollection, type TraceSource } from "./server";

/** Guards against a synchronous hang / OOM on an enormous database file. */
const MAX_DB_BYTES = 100 * 1024 * 1024;

/**
 * A TraceSource backed by an @ai-sdk/devtools database file. Reloads on
 * every notify ping from the instrumented app; a ping may move the db path
 * (apps notify from their own cwd), so paths are validated to
 * .devtools/generations.json files only. Parse failures keep the last good
 * state - the file is rewritten on every step and can be caught mid-write.
 */
export function createLiveSource(defaultDbPath: string): TraceSource & { reload(): boolean } {
  let dbPath = defaultDbPath;
  let snapshot = buildCollection([]);
  const listeners = new Set<() => void>();

  function reload(): boolean {
    let text: string;
    try {
      text = readFileSync(dbPath, "utf8");
    } catch {
      return false; // the app has not written anything yet
    }
    try {
      snapshot = buildCollection(parseCollection(JSON.parse(text)).items);
    } catch {
      // the app rewrites the file on every step, so a read can catch it
      // mid-write; keep the last good state - the next ping re-reads
      return false;
    }
    for (const listener of listeners) listener();
    return true;
  }

  return {
    live: true,
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify(remoteDbPath) {
      if (remoteDbPath !== undefined) {
        const validated = validateDbPath(remoteDbPath);
        if (validated === undefined) return false;
        dbPath = validated;
      }
      reload();
      return true;
    },
    clear() {
      try {
        // empty the file itself (matches @ai-sdk/devtools) so the clear
        // survives app restarts; a running app's in-memory cache may still
        // resurrect old runs on its next write
        writeFileSync(dbPath, JSON.stringify({ runs: [], steps: [] }, null, 2));
      } catch {
        // nothing written yet - clearing the snapshot is enough
      }
      snapshot = buildCollection([]);
      for (const listener of listeners) listener();
    },
    reload,
  };
}

/** Only real .devtools/generations.json files are accepted from notify payloads. */
function validateDbPath(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const isDbFile = (p: string) =>
    basename(p) === "generations.json" && basename(dirname(p)) === ".devtools";
  const resolved = resolve(path);
  if (!isDbFile(resolved)) return undefined;
  try {
    const stats = statSync(resolved);
    if (!stats.isFile() || stats.size > MAX_DB_BYTES) return undefined;
    const real = realpathSync(resolved);
    return isDbFile(real) ? real : undefined;
  } catch {
    return undefined;
  }
}
