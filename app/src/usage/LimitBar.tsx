import { cn } from "@/lib/utils";
import { usageTone } from "./tone";

export function LimitBar({ percent, shown = percent, className }: { percent: number; shown?: number; className?: string }) {
  const { bar } = usageTone(percent);
  return (
    <span className={cn("block h-[3px] overflow-hidden rounded-full bg-ink/10", className)}>
      <span
        className={cn("block h-full w-full origin-left rounded-full transition-[transform,background-color] duration-(--duration-panel) ease-out", bar)}
        style={{ transform: `scaleX(${Math.min(Math.max(shown, 0), 100) / 100})` }}
      />
    </span>
  );
}
