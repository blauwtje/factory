import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const cardClass = "rounded-xl border border-edge bg-raised p-4";
export const tipClass = "rounded-lg bg-overlay px-3 py-2 text-label shadow-popover";

export function Panel({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("@container flex min-w-0 flex-col gap-3", cardClass, className)}>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="shrink-0 text-body font-medium text-ink">{title}</h3>
        {aside && <div className="text-label text-faint">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function ChartTip({ left, top, children }: { left: string; top: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col whitespace-nowrap", tipClass)}
      style={{ left: `clamp(4rem, ${left}, calc(100% - 4rem))`, top }}
    >
      {children}
    </span>
  );
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="grid min-h-24 flex-1 place-items-center rounded-lg border border-dashed border-edge text-label text-faint">{children}</div>;
}

export const shortDate = (day: string) => new Date(`${day}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
export const longDate = (day: string) => new Date(`${day}T00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
