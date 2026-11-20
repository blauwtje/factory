export const HIGH_USAGE = 80;
export const CRITICAL_USAGE = 95;

export function usageTone(percent: number) {
  if (percent >= CRITICAL_USAGE) return { level: "critical", text: "text-failed-ink", bar: "bg-failed", fill: "text-failed" };
  if (percent >= HIGH_USAGE) return { level: "high", text: "text-approval-ink", bar: "bg-approval", fill: "text-approval" };
  return { level: "normal", text: "text-ink", bar: "bg-muted", fill: "text-muted" };
}
