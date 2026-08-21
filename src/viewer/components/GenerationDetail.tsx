import type { Generation } from "@core/types";
import { formatCost, formatSeconds, formatTokens } from "@core/format";
import { MessageCard } from "@/components/MessageCard";

/** The selected generation: metrics line plus its new-vs-previous messages. */
export function GenerationDetail({ generation }: { generation: Generation }) {
  const m = generation.metrics;
  return (
    <section className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-baseline gap-4">
        <h2 className="type-accent-m text-ta-sand-50">generation {generation.index}</h2>
        <span className="type-accent-s text-ta-grey-200">
          {generation.model} · {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)}{" "}
          out · {formatSeconds(m.latency)} (ttft {formatSeconds(m.timeToFirstToken)}) ·{" "}
          {formatCost(m.cost)} · {generation.toolCount} tools
        </span>
      </div>
      <p className="type-accent-s text-ta-grey-200">
        {generation.carriedMessages > 0
          ? `${generation.carriedMessages} messages carried from previous generations - showing the ${generation.newMessages.length} new`
          : `fresh conversation (segment ${generation.segment}) - ${generation.newMessages.length} messages`}
        {generation.foldedResults > 0 &&
          ` (${generation.foldedResults} tool result${generation.foldedResults === 1 ? "" : "s"} shown under calls)`}
      </p>
      <div className="flex flex-col gap-2">
        {generation.newMessages.map((message) => (
          <MessageCard key={message.index} message={message} />
        ))}
      </div>
    </section>
  );
}
