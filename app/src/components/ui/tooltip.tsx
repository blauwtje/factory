import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

export function TooltipProvider({ delay = 400, ...props }: BaseTooltip.Provider.Props) {
  return <BaseTooltip.Provider delay={delay} {...props} />;
}

export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

type TooltipContentProps = BaseTooltip.Popup.Props &
  Pick<BaseTooltip.Positioner.Props, "side" | "sideOffset" | "align">;

export function TooltipContent({ className, side = "top", sideOffset = 6, align = "center", children, ...props }: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <BaseTooltip.Popup
          data-slot="tooltip-content"
          className={cn("ui-popup ui-tooltip inline-flex max-w-xs items-center gap-2 rounded-md bg-ink px-2 py-1 text-label text-surface shadow-popover", className)}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}
