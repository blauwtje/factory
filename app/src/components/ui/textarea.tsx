import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-16 w-full resize-none rounded-md border border-field-edge bg-surface px-2.5 py-2 text-body text-ink ui-focus transition-[border-color,box-shadow] duration-(--duration-press) placeholder:text-faint hover:border-muted focus-visible:border-accent disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
