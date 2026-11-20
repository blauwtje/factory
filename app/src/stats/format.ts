import type { Tokens } from "@/ipc";

export const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export type OffsetMinutes = (at: Date) => number;
export type DayTotal = { day: string; tokens: Tokens };

export const localOffset: OffsetMinutes = (at) => -at.getTimezoneOffset();

export const emptyTokens = (): Tokens => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, uncached: 0 });

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    cache_write: a.cache_write + b.cache_write,
    cache_read: a.cache_read + b.cache_read,
    output: a.output + b.output,
    uncached: a.uncached + b.uncached,
  };
}

export const sumTokens = (items: Tokens[]) => items.reduce(addTokens, emptyTokens());

export function cacheHitRatio({ cache_read, input, cache_write }: Tokens): number {
  const total = cache_read + input + cache_write;
  return total === 0 ? 0 : cache_read / total;
}

export function tokenParts(n: number): { value: number; suffix: string } {
  if (n < 1000) return { value: n, suffix: "" };
  const [unit, suffix] = n < 999_950 ? [1000, "k"] : n < 999_950_000 ? [1_000_000, "M"] : [1_000_000_000, "B"];
  const value = n / unit;
  return { value: value >= 100 ? Math.round(value) : Math.round(value * 10) / 10, suffix };
}

export function formatTokens(n: number): string {
  const { value, suffix } = tokenParts(n);
  return `${value}${suffix}`;
}

export const count = (n: number) => n.toLocaleString("en-US");

function localDate(epochHour: number, offset: OffsetMinutes) {
  const at = new Date(epochHour * MS_PER_HOUR);
  return new Date(at.getTime() + offset(at) * 60_000);
}

export const dayOf = (epochHour: number, offset: OffsetMinutes = localOffset) => localDate(epochHour, offset).toISOString().slice(0, 10);

export const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00Z`) + by * MS_PER_DAY).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY) + 1;

export function groupByDay(byHour: [number, Tokens][], offset: OffsetMinutes = localOffset): DayTotal[] {
  const days = new Map<string, Tokens>();
  for (const [epochHour, tokens] of byHour) {
    const day = dayOf(epochHour, offset);
    days.set(day, addTokens(days.get(day) ?? emptyTokens(), tokens));
  }
  return [...days].map(([day, tokens]) => ({ day, tokens })).sort((a, b) => a.day.localeCompare(b.day));
}

export function groupByWeekHour(byHour: [number, Tokens][], offset: OffsetMinutes = localOffset): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const [epochHour, tokens] of byHour) {
    const at = localDate(epochHour, offset);
    grid[(at.getUTCDay() + 6) % 7][at.getUTCHours()] += tokens.uncached;
  }
  return grid;
}
