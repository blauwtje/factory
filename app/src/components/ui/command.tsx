import { Autocomplete } from "@base-ui/react/autocomplete";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Command = Autocomplete.Root;
export const CommandList = Autocomplete.List;
export const CommandEmpty = Autocomplete.Empty;

export function CommandInput({ className, ...props }: ComponentProps<typeof Autocomplete.Input>) {
  return (
    <Autocomplete.Input
      className={cn("w-full border-b border-rule bg-transparent px-4 py-3.5 text-title text-ink outline-none placeholder:text-faint", className)}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof Autocomplete.Item>) {
  return (
    <Autocomplete.Item
      className={cn("relative flex cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-body text-ink outline-none data-[highlighted]:bg-active", className)}
      {...props}
    />
  );
}
