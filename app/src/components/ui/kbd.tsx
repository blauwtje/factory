import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded-xs border border-edge bg-raised px-1 font-mono text-label font-medium text-muted in-data-[slot=tooltip-content]:border-transparent in-data-[slot=tooltip-content]:bg-white/15 in-data-[slot=tooltip-content]:text-current",
        className,
      )}
      {...props}
    />
  );
}

export function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex items-center gap-0.5", className)} {...props} />;
}
