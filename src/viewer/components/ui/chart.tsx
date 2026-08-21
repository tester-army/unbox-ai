import type { ReactNode } from "react";
import { ResponsiveContainer, type TooltipContentProps } from "recharts";

/** Series colors from the design system: grey = repeated/waiting, orange = fresh/active. */
export const CHART_COLORS = {
  muted: "var(--ta-grey-300)",
  accent: "var(--ta-orange-300)",
} as const;

interface ChartContainerProps {
  height: number;
  children: React.ReactElement;
}

/** shadcn-style chart shell: DS surface, mono ticks, fixed height. */
export function ChartContainer({ height, children }: ChartContainerProps) {
  return (
    <div
      className="border border-ta-grey-400 bg-ta-grey-450 p-2 [&_svg]:overflow-visible"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Recharts tooltip content matching the DS: square, bordered, no shadow. */
export function ChartTooltip({
  active,
  label,
  payload,
  format,
}: Partial<TooltipContentProps<number, string>> & {
  format?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="type-accent-s border border-ta-grey-400 bg-ta-grey-500 px-3 py-2">
      <p className="text-ta-sand-50">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="text-ta-grey-100">
          <span style={{ color: entry.color }}>■ </span>
          {entry.name}: {format ? format(Number(entry.value ?? 0)) : entry.value}
        </p>
      ))}
    </div>
  );
}

export function ChartLegend({ items }: { items: { color: string; label: ReactNode }[] }) {
  return (
    <div className="type-accent-s mb-2 flex flex-wrap gap-4 text-ta-grey-200">
      {items.map((item, i) => (
        <span key={i}>
          <span style={{ color: item.color }}>■ </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}
