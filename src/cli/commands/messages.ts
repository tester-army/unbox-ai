import type { Message, MessageRole } from "../../core/types";
import type { LoadedTrace } from "../load";
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
      // not a valid regex - fall back to a literal, case-insensitive search
      pattern = new RegExp(filter.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  }

  const hits = loaded.trace.generations.flatMap((gen) =>
    gen.newMessages
      .filter((m) => filter.role === undefined || m.role === filter.role)
      .filter((m) => filter.event === undefined || gen.index === filter.event)
      .map((m) => ({ gen: gen.index, match: findMatch(m, pattern), ...m }))
      .filter((hit) => hit.match !== null),
  );

  const shown = hits.slice(0, filter.limit);
  if (json) {
    printJson({ total: hits.length, shown: shown.length, messages: shown });
    return;
  }
  for (const hit of shown) {
    const calls = hit.toolCalls?.map((c) => c.name).join(",");
    const body =
      hit.match && hit.match.where !== "text"
        ? `matched in ${hit.match.where}: "...${hit.match.snippet}..." - drill in: unbox-ai event <trace> ${hit.gen}`
        : hit.text
          ? truncate(
              hit.text.replace(/\s+/g, " "),
              contentPointer(hit.gen, hit.index),
              240,
              hit.text.length,
            )
          : `tool_calls: ${calls} - drill in: unbox-ai event <trace> ${hit.gen}`;
    console.log(
      `[gen ${hit.gen} msg ${hit.index}] ${hit.role} (~${formatTokens(hit.approxTokens)} tok): ${body}`,
    );
  }
  if (hits.length > shown.length) {
    console.log(`\n${hits.length - shown.length} more - narrow with --grep/--role/--event or raise --limit`);
  }
}

interface Match {
  /** "text" when the message body matched (or no pattern); else the matching location. */
  where: string;
  snippet: string;
}

/** Locates the first pattern match in a message: body text, call args, or a result. */
function findMatch(m: Message, pattern: RegExp | undefined): Match | null {
  if (!pattern) return { where: "text", snippet: "" };
  if (pattern.test(m.text)) return { where: "text", snippet: "" };
  for (const call of m.toolCalls ?? []) {
    const args = JSON.stringify(call.args);
    if (pattern.test(args)) return { where: `${call.name} args`, snippet: snippet(args, pattern) };
    if (call.result !== undefined && pattern.test(call.result)) {
      return { where: `${call.name} result`, snippet: snippet(call.result, pattern) };
    }
  }
  return null;
}

function snippet(text: string, pattern: RegExp): string {
  const index = text.search(pattern);
  return text
    .slice(Math.max(0, index - 60), index + 160)
    .replace(/\s+/g, " ");
}
