import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { itemClass, popupClass } from "./surface";

export const Select = BaseSelect.Root;
export const SelectGroup = BaseSelect.Group;

export function SelectValue({ className, ...props }: BaseSelect.Value.Props) {
  return <BaseSelect.Value data-slot="select-value" className={cn("flex items-center gap-1.5 truncate", className)} {...props} />;
}

export function SelectTrigger({ className, size = "default", children, ...props }: BaseSelect.Trigger.Props & { size?: "sm" | "default" }) {
  return (
    <BaseSelect.Trigger
      data-size={size}
      className={cn(
        "flex w-fit select-none items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-field-edge bg-surface pl-2.5 pr-2 text-body text-ink ui-focus transition-[background-color,border-color] duration-(--duration-press) hover:border-muted hover:bg-raised data-[popup-open]:bg-raised data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:text-label data-[placeholder]:text-faint disabled:opacity-50 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="flex text-faint">
        <ChevronDown className="size-3.5" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

type ContentProps = BaseSelect.Popup.Props &
  Pick<BaseSelect.Positioner.Props, "align" | "side" | "sideOffset" | "alignItemWithTrigger">;

export function SelectContent({ className, children, side = "bottom", sideOffset = 6, align = "start", alignItemWithTrigger = false, ...props }: ContentProps) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner side={side} sideOffset={sideOffset} align={align} alignItemWithTrigger={alignItemWithTrigger} className="isolate z-50">
        <BaseSelect.Popup
          className={cn(popupClass, "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1", className)}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectLabel({ className, ...props }: BaseSelect.GroupLabel.Props) {
  return <BaseSelect.GroupLabel className={cn("ui-overline px-2 pb-1 pt-1.5 text-faint", className)} {...props} />;
}

export function SelectItem({ className, children, ...props }: BaseSelect.Item.Props) {
  return (
    <BaseSelect.Item className={cn(itemClass, "pr-8", className)} {...props}>
      <BaseSelect.ItemText className="flex flex-1 items-center gap-2">{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="text-accent-text!" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}

export function SelectSeparator({ className, ...props }: BaseSelect.Separator.Props) {
  return <BaseSelect.Separator className={cn("-mx-1 my-1 h-px bg-edge", className)} {...props} />;
}
