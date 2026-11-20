import { ChevronDown, Search, type LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function TaskItemFile({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border border-edge bg-raised px-1.5 py-0.5 font-mono text-label text-ink", className)} {...props} />;
}

export function TaskItem({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-body text-muted", className)} {...props} />;
}

export function Task({ defaultOpen = true, className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn("group/task", className)} defaultOpen={defaultOpen} {...props} />;
}

type TaskTriggerProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "title"> & { title: string; icon?: LucideIcon };

export function TaskTrigger({ className, title, icon: Icon = Search, children, ...props }: TaskTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn("flex w-full items-center gap-2 text-left text-body text-muted ui-focus transition-colors duration-(--duration-press) hover:text-ink", className)}
      {...props}
    >
      {children ?? (
        <>
          <Icon className="size-4" />
          <span>{title}</span>
          <ChevronDown className="size-3.5 transition-transform duration-(--duration-menu) ease-out group-data-[open]/task:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export function TaskContent({ className, children, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent className={className} {...props}>
      <div className="mt-3 flex flex-col gap-2 border-l-2 border-rule pl-4">{children}</div>
    </CollapsibleContent>
  );
}
