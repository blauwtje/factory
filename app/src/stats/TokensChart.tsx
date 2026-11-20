import { useReducedMotion } from "motion/react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import type { Tokens } from "@/ipc";
import { cn } from "@/lib/utils";
import { count, formatTokens, sumTokens, type DayTotal } from "./format";
import { EmptyChart, longDate, Panel, shortDate, tipClass } from "./Panel";
import { SERIES } from "./series";

type Row = Tokens & { day: string };

const AXIS_TICK = { fill: "var(--faint)", fontSize: 12 };

function DayTooltip({ active, payload }: Pick<TooltipContentProps<TooltipValueType, string>, "active" | "payload">) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className={cn("flex min-w-48 flex-col gap-1", tipClass)}>
      <span className="mb-0.5 font-medium text-ink">{longDate(row.day)}</span>
      {[...SERIES].reverse().map(({ key, label, color }) => (
        <span key={key} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />
          <span className="flex-1 text-muted">{label}</span>
          <span className="font-mono tabular-nums text-ink">{count(row[key])}</span>
        </span>
      ))}
      <span className="mt-1 flex items-center gap-2 border-t border-rule pt-1.5">
        <span className="flex-1 text-muted">New</span>
        <span className="font-mono font-medium tabular-nums text-ink">{count(row.uncached)}</span>
      </span>
    </div>
  );
}

function summary(days: DayTotal[], total: Tokens) {
  if (days.length === 0) return "";
  const peak = days.reduce((best, day) => (day.tokens.uncached > best.tokens.uncached ? day : best));
  return `New tokens per day from ${longDate(days[0].day)} to ${longDate(days[days.length - 1].day)}: ${count(total.uncached)} in total, most on ${longDate(peak.day)} with ${count(peak.tokens.uncached)}.`;
}

export function TokensChart({ days, emptyText, className }: { days: DayTotal[]; emptyText: string; className?: string }) {
  const reduce = useReducedMotion();
  const total = sumTokens(days.map(({ tokens }) => tokens));
  const data: Row[] = days.map(({ day, tokens }) => ({ day, ...tokens }));
  const legend = (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {SERIES.map(({ key, label, color }) => (
        <li key={key} className="flex items-center gap-1.5 text-label text-muted">
          <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />
          {label}
          <span className="font-mono tabular-nums text-ink">{formatTokens(total[key])}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <Panel title="Tokens over time" aside={legend} className={className}>
      <figure className="m-0 flex flex-col">
        <figcaption className="sr-only">{total.uncached > 0 ? summary(days, total) : emptyText}</figcaption>
        {total.uncached === 0 ? (
          <EmptyChart>{emptyText}</EmptyChart>
        ) : (
          <AreaChart className="stats-area" data={data} responsive style={{ width: "100%", height: 155 }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
            <XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} minTickGap={28} tickMargin={8} tick={AXIS_TICK} />
            <YAxis tickFormatter={formatTokens} tickLine={false} axisLine={false} width={44} tick={AXIS_TICK} />
            <Tooltip content={DayTooltip} cursor={{ stroke: "var(--control)", strokeWidth: 1 }} isAnimationActive={false} />
            {SERIES.map(({ key, label, color }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stackId="tokens"
                stroke={color}
                strokeWidth={1.5}
                fill={color}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--raised)" }}
                isAnimationActive={!reduce}
                animationDuration={280}
                animationEasing="ease-out"
              />
            ))}
          </AreaChart>
        )}
      </figure>
    </Panel>
  );
}
