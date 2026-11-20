import { ChevronDown } from "lucide-react";
import { createContext, useContext, type ComponentProps } from "react";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const PlanContext = createContext(false);

export function Plan({ className, streaming = false, ...props }: ComponentProps<typeof Collapsible> & { streaming?: boolean }) {
  return (
    <PlanContext.Provider value={streaming}>
      <Collapsible data-slot="plan" className={cn("flex flex-col rounded-lg border border-edge bg-surface", className)} {...props} />
    </PlanContext.Provider>
  );
}

export function PlanHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="plan-header" className={cn("flex items-start justify-between gap-3 p-4", className)} {...props} />;
}

function Streamable({ children }: { children: string }) {
  return useContext(PlanContext) ? <TextShimmer>{children}</TextShimmer> : children;
}

export function PlanTitle({ className, children, ...props }: Omit<ComponentProps<"h3">, "children"> & { children: string }) {
  return (
    <h3 data-slot="plan-title" className={cn("text-title font-medium text-ink", className)} {...props}>
      <Streamable>{children}</Streamable>
    </h3>
  );
}

export function PlanDescription({ className, children, ...props }: Omit<ComponentProps<"p">, "children"> & { children: string }) {
  return (
    <p data-slot="plan-description" className={cn("mt-1 text-balance text-body text-muted", className)} {...props}>
      <Streamable>{children}</Streamable>
    </p>
  );
}

export function PlanAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="plan-action" className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}

export function PlanContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent data-slot="plan-content" className={cn("px-4 pb-4 text-body", className)} {...props} />;
}

export function PlanFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="plan-footer" className={cn("flex items-center justify-end gap-2 border-t border-rule px-4 py-3", className)} {...props} />;
}

export function PlanTrigger(props: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Toggle plan" className="group/trigger aria-expanded:bg-transparent" />} {...props}>
      <ChevronDown className="transition-[rotate] duration-(--duration-menu) ease-out group-data-[panel-open]/trigger:rotate-180" />
    </CollapsibleTrigger>
  );
}
