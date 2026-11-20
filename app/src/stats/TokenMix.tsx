import { useState } from "react";
import type { Tokens } from "@/ipc";
import { cn } from "@/lib/utils";
import { count, formatTokens } from "./format";
import { ChartTip, EmptyChart, Panel } from "./Panel";
import { SERIES } from "./series";

type Key = (typeof SERIES)[number]["key"];

const percent = (part: number, whole: number) => Math.round((part / whole) * 100);

export function TokenMix({ tokens, emptyText, className }: { tokens: Tokens; emptyText: string; className?: string }) {
  const [active, setActive] = useState<Key | null>(null);
  const dim = (key: Key) => active !== null && active !== key;
  const starts = SERIES.map((_, index) => SERIES.slice(0, index).reduce((sum, { key }) => sum + tokens[key], 0));
  const index = SERIES.findIndex(({ key }) => key === active);
  const hovered = index < 0 ? null : SERIES[index];

  return (
    <Panel title="Token breakdown" aside="Without cache reads" className={className}>
      {tokens.uncached === 0 ? (
        <EmptyChart>{emptyText}</EmptyChart>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative pt-1">
            <div aria-hidden className="flex h-6 gap-0.5 overflow-hidden rounded-lg" onMouseLeave={() => setActive(null)}>
              {SERIES.map(({ key, color }) => (
                <span
                  key={key}
                  onMouseEnter={() => setActive(key)}
                  className={cn("stats-segment h-full min-w-0.5", dim(key) && "opacity-30")}
                  style={{ flexGrow: tokens[key], flexBasis: 0, background: color }}
                />
              ))}
            </div>
            {hovered && (
              <ChartTip left={`${((starts[index] + tokens[hovered.key] / 2) / tokens.uncached) * 100}%`} top="0px">
                <span className="font-medium text-ink">
                  {hovered.label}, {percent(tokens[hovered.key], tokens.uncached)}%
                </span>
                <span className="font-mono tabular-nums text-muted">{count(tokens[hovered.key])} tokens</span>
              </ChartTip>
            )}
          </div>
          <ul className="isolate flex flex-col">
            {SERIES.map(({ key, label, color }) => (
              <li
                key={key}
                onMouseEnter={() => setActive(key)}
                onMouseLeave={() => setActive(null)}
                className={cn(
                  "relative flex items-baseline gap-2 py-1 transition-opacity duration-(--duration-press) before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-lg before:bg-active before:opacity-0 before:transition-opacity before:duration-(--duration-press)",
                  dim(key) && "opacity-45",
                  active === key && "before:opacity-100",
                )}
              >
                <span className="flex flex-1 items-center gap-1.5 text-label text-muted">
                  <span aria-hidden className="size-2 rounded-xs" style={{ background: color }} />
                  {label}
                </span>
                <span className="font-mono text-body font-medium tabular-nums text-ink">{formatTokens(tokens[key])}</span>
                <span className="min-w-8 text-right font-mono text-label tabular-nums text-faint">{percent(tokens[key], tokens.uncached)}%</span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 border-t border-dashed border-edge py-1">
              <span className="flex-1 text-label text-muted">Cache read</span>
              <span className="font-mono text-body font-medium tabular-nums text-muted">{formatTokens(tokens.cache_read)}</span>
              <span className="text-label text-faint">not counted</span>
            </li>
          </ul>
        </div>
      )}
    </Panel>
  );
}
