import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import type { Tokens } from "@/ipc";
import { cn } from "@/lib/utils";
import { count, formatTokens } from "./format";
import { EmptyChart } from "./Panel";
import { modelColor } from "./series";

const SHOWN = 5;

const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");

type Row = { model: string; uncached: number; color: string };

function topModels(models: [string, Tokens][]): Row[] {
  const sorted = models.map(([model, tokens]) => ({ model, uncached: tokens.uncached })).sort((a, b) => b.uncached - a.uncached);
  const shown = sorted.slice(0, SHOWN).map((row, index) => ({ ...row, color: modelColor(index) }));
  const rest = sorted.slice(SHOWN);
  if (rest.length === 0) return shown;
  return [...shown, { model: `Other (${rest.length})`, uncached: rest.reduce((sum, { uncached }) => sum + uncached, 0), color: "var(--chart-other)" }];
}

export function ModelChart({ models }: { models: [string, Tokens][] }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const rows = topModels(models);
  const total = rows.reduce((sum, { uncached }) => sum + uncached, 0);
  const dim = (index: number) => active !== null && active !== index;
  const focused = active === null ? null : rows[active];

  return total === 0 ? (
    <EmptyChart>No model usage yet</EmptyChart>
  ) : (
    <div className="flex items-center gap-3">
      <div className="relative size-24 shrink-0" aria-hidden>
        <PieChart width={96} height={96} accessibilityLayer={false}>
          <Pie
            data={rows}
            dataKey="uncached"
            nameKey="model"
            innerRadius={34}
            outerRadius={47}
            paddingAngle={rows.length > 1 ? 2 : 0}
            cornerRadius={3}
            stroke="none"
            isAnimationActive={!reduce}
            animationBegin={0}
            animationDuration={280}
            animationEasing="ease-out"
            onMouseEnter={(_, index) => setActive(index)}
            onMouseLeave={() => setActive(null)}
          >
            {rows.map(({ model, color }, index) => (
              <Cell key={model} fill={color} className="transition-opacity duration-(--duration-press)" opacity={dim(index) ? 0.3 : 1} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-title font-medium tabular-nums text-ink">{formatTokens(focused?.uncached ?? total)}</span>
          <span className="text-label text-faint">{focused ? share(focused.uncached, total) : "new"}</span>
        </div>
      </div>
      <ul className="isolate flex min-w-0 flex-1 flex-col">
        {rows.map(({ model, uncached, color }, index) => (
          <li
            key={model}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            className={cn(
              "relative flex items-baseline gap-2 py-0.5 transition-opacity duration-(--duration-press) before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-lg before:bg-active before:opacity-0 before:transition-opacity before:duration-(--duration-press)",
              dim(index) && "opacity-45",
              active === index && "before:opacity-100",
            )}
          >
            <span aria-hidden className="size-2 shrink-0 self-center rounded-xs" style={{ background: color }} />
            <span title={model} className="min-w-0 flex-1 truncate text-body text-ink">
              {model}
            </span>
            <span title={count(uncached)} className="min-w-10 text-right font-mono text-label tabular-nums text-faint">
              {formatTokens(uncached)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
