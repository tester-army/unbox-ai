import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { NormalizedTrace } from "@core/types";
import { formatPercent, formatSeconds, formatTokens } from "@core/format";
import { CHART_COLORS, ChartContainer, ChartLegend, ChartTooltip } from "@/components/ui/chart";
import { Hint } from "@/components/ui/hint";
import { Section } from "@/components/ui/section";
import { computeInsights } from "@/lib/insights";

const TICK = { fill: "var(--ta-grey-200)", fontSize: 11, fontFamily: "var(--font-dm-mono)" };
const GRID = "var(--ta-grey-400)";

interface InsightsSectionProps {
  trace: NormalizedTrace;
  onSelect: (index: number) => void;
}

/** Derived optimization views: token sawtooth and model time per segment. */
export function InsightsSection({ trace, onSelect }: InsightsSectionProps) {
  const insights = useMemo(() => computeInsights(trace), [trace]);

  return (
    <Section
      title="insights"
      meta={
        <>
          {insights.promptWaitShare !== null && (
            <>
              <Hint term="prompt wait">prompt wait</Hint>{" "}
              {formatPercent(insights.promptWaitShare, 1)} ·{" "}
            </>
          )}
          <Hint term="repeated prefix">repeated prefix</Hint>{" "}
          {formatPercent(insights.cachedShare, 1)}
          {insights.prefixRepaid > 0 && (
            <>
              {" · "}
              <Hint term="re-paid prefix">re-paid</Hint> ~{formatTokens(insights.prefixRepaid)}
            </>
          )}
        </>
      }
    >
      <div className="grid gap-6 px-6 pb-5 lg:grid-cols-2">
        <div>
          <p className="type-accent-s mb-2 text-ta-grey-200">
            input tokens per generation · click a bar to jump
          </p>
          <ChartLegend
            items={[
              { color: CHART_COLORS.muted, label: "repeated prefix (cache-eligible)" },
              { color: CHART_COLORS.accent, label: "fresh input" },
            ]}
          />
          <ChartContainer height={220}>
            <BarChart
              data={insights.perGeneration}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              onClick={(state) => {
                const index = Number(state?.activeLabel);
                if (Number.isFinite(index)) onSelect(index);
              }}
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="index" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
              <YAxis tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatTokens(v)} />
              <Tooltip
                cursor={{ fill: "var(--ta-grey-400)", opacity: 0.3 }}
                content={<ChartTooltip format={(v: number) => `${formatTokens(v)} tok`} />}
              />
              <Bar dataKey="cached" name="repeated prefix" stackId="in" fill={CHART_COLORS.muted} className="cursor-pointer" />
              <Bar dataKey="fresh" name="fresh input" stackId="in" fill={CHART_COLORS.accent} className="cursor-pointer" />
            </BarChart>
          </ChartContainer>
        </div>

        <div>
          <p className="type-accent-s mb-2 text-ta-grey-200">model time per segment</p>
          <ChartLegend
            items={[
              { color: CHART_COLORS.muted, label: "prompt wait (ttft)" },
              { color: CHART_COLORS.accent, label: "generation" },
            ]}
          />
          <ChartContainer height={220}>
            <BarChart
              data={insights.perSegment}
              layout="vertical"
              margin={{ top: 4, right: 8, bottom: 0, left: -6 }}
            >
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v: number) => `${v}s`} />
              <YAxis
                type="category"
                dataKey="segment"
                tick={TICK}
                tickLine={false}
                axisLine={false}
                width={34}
                tickFormatter={(v: number) => `s${v}`}
              />
              <Tooltip
                cursor={{ fill: "var(--ta-grey-400)", opacity: 0.3 }}
                content={<ChartTooltip format={(v: number) => formatSeconds(v)} />}
              />
              <Bar dataKey="promptWait" name="prompt wait" stackId="t" fill={CHART_COLORS.muted} />
              <Bar dataKey="generation" name="generation" stackId="t" fill={CHART_COLORS.accent} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </Section>
  );
}
