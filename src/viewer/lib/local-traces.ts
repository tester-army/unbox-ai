import type { TraceCollectionItem } from "@core/collection";
import type { RawTrace } from "@core/types";

/** Browser-opened runs by trace id; parsed locally, never known to the server. */
const items = new Map<string, TraceCollectionItem>();

/** Every browser-opened run, in open order. */
export function localItems(): TraceCollectionItem[] {
  return [...items.values()];
}

/** The raw trace behind a browser-opened run, or undefined for server runs. */
export function localRawTrace(traceId: string): RawTrace | undefined {
  return items.get(traceId)?.raw;
}

/** A browser-opened run with its raw form, or undefined for server runs. */
export function localTraceItem(traceId: string): TraceCollectionItem | undefined {
  return items.get(traceId);
}

/** Registers adopted runs; they last until the page reloads or their source closes. */
export function addLocalItems(adopted: TraceCollectionItem[]): void {
  for (const item of adopted) items.set(item.trace.traceId, item);
}

/** Drops every browser-opened run of a closed source. */
export function removeLocalSource(source: string): void {
  for (const [id, item] of items) {
    if (item.sourcePath === source) items.delete(id);
  }
}

/** The dropped file's name, counted up when a tab by that name already exists. */
export function uniqueSource(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
}

/**
 * Tags parsed runs with their tab source and de-collides run ids against
 * already-listed ones (reopening a served file), keeping parent links whole.
 */
export function adoptItems(
  parsed: TraceCollectionItem[],
  source: string,
  takenIds: Set<string>,
): TraceCollectionItem[] {
  const rename = new Map<string, string>();
  for (const { trace } of parsed) {
    let id = trace.traceId;
    if (takenIds.has(id)) {
      let n = 2;
      while (takenIds.has(`${id} (${n})`)) n++;
      id = `${id} (${n})`;
      rename.set(trace.traceId, id);
    }
    takenIds.add(id);
  }
  return parsed.map((item) => {
    const trace = {
      ...item.trace,
      traceId: rename.get(item.trace.traceId) ?? item.trace.traceId,
      parentTraceId:
        item.trace.parentTraceId !== undefined
          ? (rename.get(item.trace.parentTraceId) ?? item.trace.parentTraceId)
          : undefined,
    };
    return { raw: item.raw, trace, sourcePath: source };
  });
}
