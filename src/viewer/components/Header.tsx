import { formatCost, formatSeconds, formatTokens } from "@core/format";
import type { NormalizedTrace } from "@core/types";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Hint } from "@/components/ui/hint";

interface HeaderProps {
  trace: NormalizedTrace;
  /** Shell command an agent runs to explore this run from the CLI. */
  agentCommand?: string;
  /** Present when at least two runs exist; toggles the A/B compare view. */
  onCompare?: () => void;
  comparing?: boolean;
  /** Present in live devtools mode; empties the backing database. */
  onClear?: () => void;
}

export function Header({ trace, agentCommand, onCompare, comparing, onClear }: HeaderProps) {
  return (
    <header className="flex items-baseline gap-6 overflow-hidden border-b border-ta-grey-400 px-6 py-4">
      <h1 className="type-accent-m shrink-0 text-ta-orange-300">unbox-ai</h1>
      <span className="type-body-m min-w-0 truncate text-ta-sand-50">{trace.name}</span>
      <span className="type-accent-s min-w-0 truncate text-ta-grey-200">
        {trace.models.join(", ")}
      </span>
      <div className="type-accent-s ml-auto flex shrink-0 items-baseline gap-6 whitespace-nowrap text-ta-grey-100">
        <Stat
          label={<Hint term="generation">generations</Hint>}
          value={String(trace.generations.length)}
        />
        <Stat label={<Hint term="segment">segments</Hint>} value={String(trace.segmentCount)} />
        <Stat label="in" value={formatTokens(trace.totalTokens.input)} />
        <Stat label="out" value={formatTokens(trace.totalTokens.output)} />
        <Stat
          label={<Hint term="model time">model time</Hint>}
          value={formatSeconds(trace.totalLatency)}
        />
        {/* traces without price data report 0 - a real run never costs exactly $0 */}
        {trace.totalCost > 0 && <Stat label="cost" value={formatCost(trace.totalCost)} />}
        {onCompare && (
          <Button
            onClick={onCompare}
            aria-pressed={comparing}
            className={comparing ? "border-ta-orange-300 text-ta-orange-300" : undefined}
          >
            compare
          </Button>
        )}
        {agentCommand ? (
          <CopyButton label="copy for agent" text={agentCommand} title={agentCommand} />
        ) : (
          <Button
            disabled
            className="cursor-default opacity-40 hover:border-ta-grey-400 hover:text-ta-grey-100"
            title="opened in this browser - agents need a file on disk"
          >
            copy for agent
          </Button>
        )}
        {onClear && <Button onClick={onClear}>clear</Button>}
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <span>
      <span className="text-ta-grey-200">{label} </span>
      <span className="text-ta-sand-50">{value}</span>
    </span>
  );
}
