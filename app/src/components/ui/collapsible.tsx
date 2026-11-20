import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";

export const Collapsible = BaseCollapsible.Root;
export const CollapsibleTrigger = BaseCollapsible.Trigger;

export function CollapsibleContent({ className, ...props }: BaseCollapsible.Panel.Props) {
  return <BaseCollapsible.Panel className={cn("ui-collapse", className)} {...props} />;
}
