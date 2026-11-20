import NumberFlow from "@number-flow/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { tokenParts } from "./format";
import { cardClass } from "./Panel";

const PERCENT = { style: "percent", maximumFractionDigits: 0 } as const;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

export const FLOW = {
  transformTiming: { duration: 280, easing: EASE_OUT },
  spinTiming: { duration: 280, easing: EASE_OUT },
  opacityTiming: { duration: 160, easing: EASE_OUT },
};

export function TokenFlow({ value }: { value: number }) {
  const { value: scaled, suffix } = tokenParts(value);
  return <NumberFlow {...FLOW} value={scaled} suffix={suffix} locales="en-US" format={{ maximumFractionDigits: 1 }} />;
}

export function CountFlow({ value }: { value: number }) {
  return <NumberFlow {...FLOW} value={value} locales="en-US" />;
}

function Delta({ value: exact }: { value: number }) {
  const value = Math.round(exact * 100) / 100;
  const Arrow = value === 0 ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = value < 0 ? "bg-active text-muted" : "bg-accent-soft text-accent-text";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-label font-medium tabular-nums", tone)}>
      <Arrow aria-hidden className="size-3" />
      <span className="sr-only">{value === 0 ? "Unchanged" : value > 0 ? "Up" : "Down"}</span>
      <NumberFlow {...FLOW} value={Math.abs(value)} format={PERCENT} locales="en-US" />
    </span>
  );
}

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const points = (values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0]).map((value, index) => `${(index * step).toFixed(2)},${(30 - (value / max) * 26).toFixed(2)}`);
  const line = `M${points.join("L")}`;
  return (
    <svg aria-hidden viewBox="0 0 100 32" preserveAspectRatio="none" className="h-6 w-full overflow-visible">
      <path d={`${line}L100,32L0,32Z`} fill={color} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DayStrip({ active }: { active: boolean[] }) {
  return (
    <div aria-hidden className={cn("flex h-6 items-end", active.length <= 60 && "gap-px")}>
      {active.map((on, index) => (
        <span key={index} className={cn("min-w-px flex-1 rounded-[1px]", on ? "h-full bg-(--chart-1)" : "h-1.5 bg-active")} />
      ))}
    </div>
  );
}

function Value({ children, detail }: { children: ReactNode; detail?: string }) {
  const id = useId();
  const className = "font-mono text-display font-medium tabular-nums text-ink";
  if (!detail) return <p className={className}>{children}</p>;
  return (
    <Tooltip>
      <TooltipTrigger render={<p tabIndex={0} aria-describedby={id} className={cn("self-start rounded-sm ui-focus", className)} />}>
        {children}
        <span id={id} hidden>
          {detail}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

export function KpiCard({ label, value, delta, hint, detail, chart }: { label: string; value: ReactNode; delta: number | null; hint: string; detail?: string; chart: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-2", cardClass)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-muted">{label}</p>
        {delta !== null && (
          <span title={hint} className="shrink-0">
            <Delta value={delta} />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <Value detail={detail}>{value}</Value>
        <div className="w-1/2 shrink-0">{chart}</div>
      </div>
    </div>
  );
}
