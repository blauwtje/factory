import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "h-8 w-full rounded-md border border-field-edge bg-surface px-2.5 text-body text-ink ui-focus transition-[border-color,box-shadow] duration-(--duration-press) placeholder:text-faint hover:border-muted focus:border-accent";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldClass, "w-auto pr-2", className)} {...props} />;
}
