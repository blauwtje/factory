import type { Tokens } from "@/ipc";
import { dayOf, daysBetween, emptyTokens, groupByDay, localOffset, shiftDay, type DayTotal, type OffsetMinutes } from "./format";

export const RANGES = {
  "7d": { label: "7 days", days: 7 },
  "30d": { label: "30 days", days: 30 },
  all: { label: "All", days: null },
} as const;

export type RangeKey = keyof typeof RANGES;

export type Period = {
  from: string;
  to: string;
  days: DayTotal[];
  previous: DayTotal[] | null;
  byHour: [number, Tokens][];
};

function fill(totals: Map<string, Tokens>, from: string, to: string): DayTotal[] {
  return Array.from({ length: daysBetween(from, to) }, (_, index) => {
    const day = shiftDay(from, index);
    return { day, tokens: totals.get(day) ?? emptyTokens() };
  });
}

export function period(byHour: [number, Tokens][], range: RangeKey, today: string, offset: OffsetMinutes = localOffset): Period {
  const totals = groupByDay(byHour, offset);
  const byDay = new Map(totals.map(({ day, tokens }) => [day, tokens]));
  const first = totals[0]?.day ?? today;
  const length = RANGES[range].days ?? Math.max(1, daysBetween(first, today));
  const from = shiftDay(today, 1 - length);
  const previousFrom = shiftDay(from, -length);
  const comparable = RANGES[range].days !== null && first <= previousFrom;
  return {
    from,
    to: today,
    days: fill(byDay, from, today),
    previous: comparable ? fill(byDay, previousFrom, shiftDay(from, -1)) : null,
    byHour: byHour.filter(([hour]) => {
      const day = dayOf(hour, offset);
      return day >= from && day <= today;
    }),
  };
}

export function change(current: number, previous: number | undefined) {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}
