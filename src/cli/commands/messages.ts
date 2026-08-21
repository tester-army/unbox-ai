import type { MessageRole } from "../../core/types";
import { fail, type LoadedTrace } from "../load";
import { contentPointer, formatTokens, printJson, truncate } from "../output";

export interface MessagesFilter {
  role?: MessageRole;
  event?: number;
  grep?: string;
  limit: number;
}

/** Searches unique messages across all generations with role/event/grep filters. */
export function messages(loaded: LoadedTrace, filter: MessagesFilter, json: boolean): void {
  let pattern: RegExp | undefined;
  if (filter.grep !== undefined) {
    try {
      pattern = new RegExp(filter.grep, "i");
    } catch {
      fail(`Invalid regex: ${filter.grep}`);
    }
  }

  const hits = loaded.trace.generations.flatMap((gen) =>
    gen.newMessages
      .filter((m) => filter.role === undefined || m.role === filter.role)
      .filter((m) => filter.event === undefined || gen.index === filter.event)
      .filter((m) => {
        if (!pattern) return true;
        const callText = (m.toolCalls ?? [])
          .map((c) => `${c.name} ${JSON.stringify(c.args)} ${c.result ?? ""}`)
          .join(" ");
        return pattern.test(m.text) || pattern.test(callText);
      })
      .map((m) => ({ gen: gen.index, ...m })),
  );

  const shown = hits.slice(0, filter.limit);
  if (json) {
    printJson({ total: hits.length, shown: shown.length, messages: shown });
    return;
  }
  for (const hit of shown) {
    const calls = hit.toolCalls?.map((c) => c.name).join(",");
    const body = hit.text
      ? truncate(hit.text.replace(/\s+/g, " "), contentPointer(hit.gen, hit.index), 240)
      : `tool_calls: ${calls} - drill in: unbox-ai event <trace> ${hit.gen}`;
    console.log(
      `[gen ${hit.gen} msg ${hit.index}] ${hit.role} (~${formatTokens(hit.approxTokens)} tok): ${body}`,
    );
  }
  if (hits.length > shown.length) {
    console.log(`\n${hits.length - shown.length} more - narrow with --grep/--role/--event or raise --limit`);
  }
}
