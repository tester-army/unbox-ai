import type { NormalizedTrace } from "@core/types";
import { formatCost, formatSeconds, formatTokens } from "@core/format";

export function Header({ trace }: { trace: NormalizedTrace }) {
  return (
    <header className="flex items-baseline gap-6 border-b border-ta-grey-400 px-6 py-4">
      <h1 className="type-accent-m text-ta-orange-300">unbox-ai</h1>
      <span className="type-body-m text-ta-sand-50">{trace.name}</span>
      <span className="type-accent-s text-ta-grey-200">{trace.models.join(", ")}</span>
      <div className="type-accent-s ml-auto flex gap-6 text-ta-grey-100">
        <Stat label="generations" value={String(trace.generations.length)} />
        <Stat label="segments" value={String(trace.segmentCount)} />
        <Stat label="in" value={formatTokens(trace.totalTokens.input)} />
        <Stat label="out" value={formatTokens(trace.totalTokens.output)} />
        <Stat label="model time" value={formatSeconds(trace.totalLatency)} />
        <Stat label="cost" value={formatCost(trace.totalCost)} />
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-ta-grey-200">{label} </span>
      <span className="text-ta-sand-50">{value}</span>
    </span>
  );
}
