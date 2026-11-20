import { useState, type KeyboardEvent } from "react";
import { count } from "./format";
import { ChartTip, EmptyChart, Panel } from "./Panel";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOUR_TICKS = [0, 6, 12, 18];
const LEVELS = [0, 1, 2, 3, 4];

type Cell = { day: number; hour: number };
type Active = Cell & { by: "key" | "pointer" };

const MOVES: Record<string, Cell> = {
  ArrowLeft: { day: 0, hour: -1 },
  ArrowRight: { day: 0, hour: 1 },
  ArrowUp: { day: -1, hour: 0 },
  ArrowDown: { day: 1, hour: 0 },
};

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const level = (value: number, max: number) => (value === 0 ? 0 : Math.max(1, Math.ceil((value / max) * 4)));
const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, value));

function busiest(grid: number[][]): Cell {
  const cells = grid.flatMap((hours, day) => hours.map((value, hour) => ({ day, hour, value })));
  const { day, hour } = cells.reduce((best, cell) => (cell.value > best.value ? cell : best));
  return { day, hour };
}

const describe = ({ day, hour }: Cell, value: number) => `${WEEKDAYS[day]} ${hourLabel(hour)} to ${hourLabel((hour + 1) % 24)}: ${count(value)} new tokens`;

export function Heatmap({ grid, emptyText, className }: { grid: number[][]; emptyText: string; className?: string }) {
  const [active, setActive] = useState<Active | null>(null);
  const max = Math.max(0, ...grid.flat());
  const peak = busiest(grid);

  function move(event: KeyboardEvent) {
    const step = MOVES[event.key];
    if (!step) return;
    event.preventDefault();
    const from = active ?? peak;
    setActive({ day: clamp(from.day + step.day, 7), hour: clamp(from.hour + step.hour, 24), by: "key" });
  }

  const legend = (
    <span className="flex items-center gap-1.5">
      Less
      {LEVELS.map((step) => (
        <span key={step} data-level={step} className="stats-heat size-2.5 rounded-[3px]" />
      ))}
      More
    </span>
  );

  return (
    <Panel title="Activity by weekday and hour" aside={max > 0 && legend} className={className}>
      {max === 0 ? (
        <EmptyChart>{emptyText}</EmptyChart>
      ) : (
        <div className="flex flex-col gap-2 [--heat-cell:1rem] [--heat-gap:3px] [--heat-label:2.25rem]">
          <div
            role="group"
            tabIndex={0}
            aria-label={`Activity by weekday and hour, local time. Busiest: ${describe(peak, grid[peak.day][peak.hour])}. Use the arrow keys to read each hour.`}
            onKeyDown={move}
            onFocus={() => setActive((current) => current ?? { ...peak, by: "key" })}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
            className="relative grid grid-cols-[var(--heat-label)_repeat(24,minmax(0,1fr))] gap-(--heat-gap) rounded-md ui-focus"
          >
            {grid.map((hours, day) => [
              <span key={`label-${day}`} aria-hidden className="self-center text-label text-faint">
                {WEEKDAYS[day].slice(0, 3)}
              </span>,
              ...hours.map((value, hour) => (
                <span
                  key={`${day}-${hour}`}
                  data-level={level(value, max)}
                  data-active={active?.day === day && active.hour === hour ? "" : undefined}
                  onMouseEnter={() => setActive({ day, hour, by: "pointer" })}
                  className="stats-heat h-(--heat-cell) rounded-[4px]"
                />
              )),
            ])}
            {active && (
              <ChartTip
                left={`calc(var(--heat-label) + (100% - var(--heat-label)) * ${(active.hour + 0.5) / 24})`}
                top={`calc(${active.day} * (var(--heat-cell) + var(--heat-gap)) - 6px)`}
              >
                <span className="font-medium text-ink">
                  {WEEKDAYS[active.day]} {hourLabel(active.hour)}
                </span>
                <span className="font-mono tabular-nums text-muted">{count(grid[active.day][active.hour])} new</span>
              </ChartTip>
            )}
          </div>
          <div aria-hidden className="grid grid-cols-[var(--heat-label)_repeat(24,minmax(0,1fr))] gap-(--heat-gap) text-label text-faint">
            {HOUR_TICKS.map((hour) => (
              <span key={hour} style={{ gridColumn: `${hour + 2} / span 6` }} className="font-mono tabular-nums">
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          <p aria-live="polite" className="sr-only">
            {active?.by === "key" ? describe(active, grid[active.day][active.hour]) : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
