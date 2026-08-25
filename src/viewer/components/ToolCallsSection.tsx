import { formatCompact, formatMs } from "@core/format";
import { allToolCalls } from "@core/normalize";
import type { NormalizedTrace, PairedToolCall } from "@core/types";
import { Fragment, useMemo, useState } from "react";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const GRID =
  "grid grid-cols-[minmax(9rem,1fr)_4rem_4rem_5rem_5rem_minmax(6rem,1.5fr)] items-center gap-x-4";

interface ToolUsage {
  name: string;
  calls: (PairedToolCall & { gen: number })[];
  failures: number;
  totalMs: number | null;
  totalSize: number;
}

interface ToolCallsSectionProps {
  trace: NormalizedTrace;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Tool usage summary: one row per tool, expandable to its individual calls. */
export function ToolCallsSection({ trace, onSelect }: ToolCallsSectionProps) {
  const [openTool, setOpenTool] = useState<string | null>(null);
  const usage = useMemo(() => {
    const byName = new Map<string, ToolUsage>();
    for (const call of allToolCalls(trace)) {
      const entry = byName.get(call.name) ?? {
        name: call.name,
        calls: [],
        failures: 0,
        totalMs: null,
        totalSize: 0,
      };
      entry.calls.push(call);
      if (call.success === false) entry.failures += 1;
      if (call.durationMs !== undefined) entry.totalMs = (entry.totalMs ?? 0) + call.durationMs;
      entry.totalSize += call.result?.length ?? 0;
      byName.set(call.name, entry);
    }
    return [...byName.values()].sort((a, b) => b.calls.length - a.calls.length);
  }, [trace]);

  if (usage.length === 0) return null;
  const maxSize = Math.max(...usage.map((u) => u.totalSize), 1);
  const totalCalls = usage.reduce((a, u) => a + u.calls.length, 0);

  return (
    <Section
      title="tools"
      meta={`${totalCalls} calls across ${usage.length} tools · click a tool for its calls`}
    >
      <div className="type-accent-s px-6 pb-4">
        <div className={cn(GRID, "border-b border-ta-grey-400 pb-1 text-ta-grey-200")}>
          <span>tool</span>
          <span className="text-right">calls</span>
          <span className="text-right">failed</span>
          <span className="text-right">time</span>
          <span className="text-right" title="total result chars">
            output
          </span>
          <span title="share of total tool output">output share</span>
        </div>
        {usage.map((tool) => (
          <Fragment key={tool.name}>
            <button
              type="button"
              onClick={() => setOpenTool((v) => (v === tool.name ? null : tool.name))}
              aria-expanded={openTool === tool.name}
              className={cn(
                GRID,
                "w-full cursor-pointer border-b border-ta-grey-450 py-1.5 text-left transition-colors hover:bg-ta-grey-450",
                openTool === tool.name && "bg-ta-grey-450",
              )}
            >
              <span className="truncate text-ta-sand-50">{tool.name}</span>
              <span className="text-right text-ta-grey-100">{tool.calls.length}</span>
              <span
                className={cn(
                  "text-right",
                  tool.failures > 0 ? "text-ta-error" : "text-ta-grey-300",
                )}
              >
                {tool.failures > 0 ? tool.failures : "-"}
              </span>
              <span className="text-right text-ta-grey-100">
                {tool.totalMs !== null ? formatMs(tool.totalMs) : "-"}
              </span>
              <span className="text-right text-ta-grey-200">{formatCompact(tool.totalSize)}</span>
              <span className="relative h-2 bg-ta-grey-450">
                <span
                  className="absolute inset-y-0 left-0 bg-ta-orange-300"
                  style={{ width: `${(tool.totalSize / maxSize) * 100}%` }}
                />
              </span>
            </button>
            {openTool === tool.name &&
              tool.calls.map((call) => (
                <button
                  type="button"
                  key={`${call.gen}:${call.id}`}
                  onClick={() => onSelect(call.gen)}
                  title="jump to this generation"
                  className="flex w-full cursor-pointer items-center gap-4 border-b border-ta-grey-450 py-1 pl-6 text-left transition-colors hover:bg-ta-grey-450"
                >
                  <span className="w-8 shrink-0 text-right text-ta-grey-300">{call.gen}</span>
                  <span className="min-w-0 flex-1 truncate normal-case text-ta-grey-200">
                    {typeof call.args === "string" ? call.args : JSON.stringify(call.args)}
                  </span>
                  {call.success === false && <span className="shrink-0 text-ta-error">failed</span>}
                  <span className="w-14 shrink-0 text-right text-ta-grey-200">
                    {call.durationMs !== undefined ? formatMs(call.durationMs) : ""}
                  </span>
                  <span className="w-12 shrink-0 text-right text-ta-grey-300">
                    {call.result !== undefined ? formatCompact(call.result.length) : "-"}
                  </span>
                </button>
              ))}
          </Fragment>
        ))}
      </div>
    </Section>
  );
}
