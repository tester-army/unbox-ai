import { formatCost, formatPercent, formatSeconds, formatTokens } from "@core/format";
import type { Generation, NormalizedTrace } from "@core/types";
import { useState } from "react";
import { MessageCard } from "@/components/MessageCard";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Section } from "@/components/ui/section";

interface GenerationDetailProps {
  trace: NormalizedTrace;
  generation: Generation;
}

/** The selected generation: metrics line plus its new-vs-previous messages. */
export function GenerationDetail({ trace, generation }: GenerationDetailProps) {
  const [showCarried, setShowCarried] = useState(false);
  const m = generation.metrics;
  // the carried context is the thread's earlier messages, shown dimmed
  const carried = showCarried
    ? trace.generations
        .filter((g) => g.segment === generation.segment && g.index < generation.index)
        .flatMap((g) => g.newMessages)
    : [];
  return (
    <Section
      title={`generation ${generation.index}`}
      hint="generation"
      meta={
        <>
          {generation.model} · {formatTokens(m.inputTokens)} in / {formatTokens(m.outputTokens)}
          {m.reasoningTokens !== undefined && ` (${formatTokens(m.reasoningTokens)} reasoning)`} out
          ·{" "}
          {generation.inProgress ? (
            <span className="text-ta-orange-300">streaming...</span>
          ) : (
            formatSeconds(m.latency)
          )}
          {m.timeToFirstToken !== undefined && ` (ttft ${formatSeconds(m.timeToFirstToken)})`}
          {m.cost > 0 && <> · {formatCost(m.cost)}</>} · {generation.toolCount} tools
        </>
      }
    >
      <div className="flex flex-col gap-3 px-6 pb-4">
        <p className="type-accent-s text-ta-grey-200">
          {generation.carriedMessages > 0
            ? `${generation.carriedMessages} carried messages, showing the ${generation.newMessages.length} new`
            : `fresh conversation (segment ${generation.segment}), ${generation.newMessages.length} messages`}
          {generation.breakdown.cacheableTokens > 0 && (
            <>
              {" · "}
              {formatPercent(generation.breakdown.cacheableTokens, generation.metrics.inputTokens)}{" "}
              <Hint term="repeated prefix">repeated prefix</Hint>
            </>
          )}
          {generation.metrics.timeToFirstToken !== undefined && (
            <>
              {" · "}
              <Hint term="prompt wait">prompt wait</Hint>{" "}
              {formatPercent(generation.metrics.timeToFirstToken, generation.metrics.latency)} of
              latency
            </>
          )}
        </p>
        {generation.carriedMessages > 0 && (
          <Button className="self-start" onClick={() => setShowCarried((v) => !v)}>
            {showCarried
              ? "hide carried context"
              : `show carried context (${generation.carriedMessages} messages)`}
          </Button>
        )}
        {showCarried && (
          <div className="flex flex-col gap-2 opacity-60">
            {carried.map((message) => (
              <MessageCard key={`carried-${message.index}`} message={message} />
            ))}
          </div>
        )}
        {showCarried && carried.length > 0 && (
          <p className="type-accent-s text-ta-grey-200">new in this generation ↓</p>
        )}
        <div className="flex flex-col gap-2">
          {generation.newMessages.map((message) => (
            <MessageCard key={message.index} message={message} />
          ))}
        </div>
      </div>
    </Section>
  );
}
