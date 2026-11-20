import type { Account, UsageLimit } from "@/ipc";

export function resetTime(resetsAt: number) {
  const date = new Date(resetsAt * 1000);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (resetsAt - Date.now() / 1000 < 86_400) return time;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export const resetText = (limit: UsageLimit) => (limit.resets_at === null ? limit.label : `${limit.label} resets ${resetTime(limit.resets_at)}`);

export const shownPercent = (limit: UsageLimit, remaining: boolean) => (remaining ? Math.max(0, 100 - limit.percent) : limit.percent);

export const peakPercent = (account: Account) => (account.limits.length === 0 ? null : Math.round(Math.max(...account.limits.map((limit) => limit.percent))));

export function updatedAgo(updatedAt: number | null, now: number) {
  if (updatedAt === null) return "Not updated yet";
  const minutes = Math.floor((now - updatedAt) / 60);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  if (minutes < 1_440) return `Updated ${Math.floor(minutes / 60)}h ago`;
  return `Updated ${Math.floor(minutes / 1_440)}d ago`;
}
