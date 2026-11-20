import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { itemClass, popupClass } from "./surface";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;
export const DropdownMenuSub = Menu.SubmenuRoot;

type ContentProps = Menu.Popup.Props & Pick<Menu.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">;

export function DropdownMenuContent({ className, align = "start", alignOffset = 0, side = "bottom", sideOffset = 6, ...props }: ContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner className="isolate z-50 outline-none" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset}>
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClass, "max-h-(--available-height) min-w-44 overflow-y-auto p-1", className)}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, variant = "default", ...props }: Menu.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <Menu.Item
      data-variant={variant}
      className={cn(itemClass, "data-[variant=destructive]:text-failed-ink data-[variant=destructive]:[&_svg]:text-failed-ink", className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: Menu.CheckboxItem.Props) {
  return (
    <Menu.CheckboxItem className={cn(itemClass, "pr-8", className)} {...props}>
      {children}
      <Menu.CheckboxItemIndicator className="absolute right-2 flex items-center">
        <Check className="text-accent-text!" />
      </Menu.CheckboxItemIndicator>
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem className={cn(itemClass, "pr-8", className)} {...props}>
      {children}
      <Menu.RadioItemIndicator className="absolute right-2 flex items-center">
        <Check className="text-accent-text!" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: Menu.GroupLabel.Props) {
  return <Menu.GroupLabel className={cn("ui-overline px-2 pb-1 pt-1.5 text-faint", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div role="separator" className={cn("-mx-1 my-1 h-px bg-edge", className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("ml-auto pl-4 text-label text-faint", className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, children, ...props }: Menu.SubmenuTrigger.Props) {
  return (
    <Menu.SubmenuTrigger className={cn(itemClass, "data-[popup-open]:bg-active", className)} {...props}>
      {children}
      <ChevronRight className="ml-auto" />
    </Menu.SubmenuTrigger>
  );
}

export function DropdownMenuSubContent(props: ContentProps) {
  return <DropdownMenuContent side="right" sideOffset={2} alignOffset={-4} {...props} />;
}
