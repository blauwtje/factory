import { Autocomplete } from "@base-ui/react/autocomplete";
import type { ComponentProps, ReactNode } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const ModelSelector = Dialog;
export const ModelSelectorTrigger = DialogTrigger;

type ContentProps = ComponentProps<typeof DialogContent> & { title?: string; items?: ComponentProps<typeof Command>["items"] };

export function ModelSelectorContent({ className, children, title = "Select model", items, ...props }: ContentProps) {
  return (
    <DialogContent className={cn("overflow-hidden p-0", className)} {...props}>
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <Command inline open items={items}>
        {children}
      </Command>
    </DialogContent>
  );
}

export function ModelSelectorInput({ className, ...props }: ComponentProps<typeof CommandInput>) {
  return <CommandInput className={cn("px-4 py-3.5 text-body", className)} {...props} />;
}

export function ModelSelectorList({ className, ...props }: ComponentProps<typeof CommandList>) {
  return <CommandList className={cn("max-h-80 overflow-y-auto p-1.5", className)} {...props} />;
}

export function ModelSelectorEmpty({ className, ...props }: ComponentProps<typeof CommandEmpty>) {
  return <CommandEmpty className={cn("px-3 py-6 text-center text-body text-muted empty:hidden", className)} {...props} />;
}

export function ModelSelectorGroup({ className, label, children, ...props }: ComponentProps<typeof Autocomplete.Group> & { label?: ReactNode }) {
  return (
    <Autocomplete.Group className={cn("py-1", className)} {...props}>
      {label && <Autocomplete.GroupLabel className="px-3 pb-1 pt-1.5 text-label font-medium text-faint">{label}</Autocomplete.GroupLabel>}
      {children}
    </Autocomplete.Group>
  );
}

export function ModelSelectorItem({ className, ...props }: ComponentProps<typeof CommandItem>) {
  return <CommandItem className={cn("flex items-center gap-2.5 px-3 py-2 text-body", className)} {...props} />;
}

export function ModelSelectorShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("ml-auto text-label text-faint", className)} {...props} />;
}

export function ModelSelectorName({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("flex-1 truncate", className)} {...props} />;
}
