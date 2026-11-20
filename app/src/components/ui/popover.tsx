import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { popupClass } from "./surface";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverClose = BasePopover.Close;

type ContentProps = BasePopover.Popup.Props & Pick<BasePopover.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

type KeepMounted = { keepMounted?: boolean };

export function PopoverContent({ className, align = "center", alignOffset = 0, side = "bottom", sideOffset = 6, keepMounted, ...props }: ContentProps & KeepMounted) {
  return (
    <BasePopover.Portal keepMounted={keepMounted}>
      <BasePopover.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} className="isolate z-50">
        <BasePopover.Popup className={cn(popupClass, "flex w-72 flex-col gap-2.5 p-3 text-body", className)} {...props} />
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export function PopoverTitle({ className, ...props }: BasePopover.Title.Props) {
  return <BasePopover.Title className={cn("text-body font-medium", className)} {...props} />;
}

export function PopoverDescription({ className, ...props }: BasePopover.Description.Props) {
  return <BasePopover.Description className={cn("text-body text-muted", className)} {...props} />;
}
