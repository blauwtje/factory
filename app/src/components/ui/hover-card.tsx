import { PreviewCard } from "@base-ui/react/preview-card";
import { cn } from "@/lib/utils";
import { popupClass } from "./surface";

export const HoverCard = PreviewCard.Root;
export const HoverCardTrigger = PreviewCard.Trigger;

type ContentProps = PreviewCard.Popup.Props & Pick<PreviewCard.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

export function HoverCardContent({ className, side = "bottom", sideOffset = 6, align = "center", alignOffset = 0, ...props }: ContentProps) {
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} className="isolate z-50">
        <PreviewCard.Popup className={cn(popupClass, "w-64 p-3 text-body", className)} {...props} />
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  );
}
