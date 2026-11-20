import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";

export function ScrollArea({ className, children, ...props }: BaseScrollArea.Root.Props) {
  return (
    <BaseScrollArea.Root className={cn("relative min-h-0 overflow-hidden", className)} {...props}>
      <BaseScrollArea.Viewport className="size-full overscroll-contain rounded-[inherit] ui-focus-inset">
        {children}
      </BaseScrollArea.Viewport>
      <ScrollBar />
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  );
}

export function ScrollBar({ className, orientation = "vertical", ...props }: BaseScrollArea.Scrollbar.Props) {
  return (
    <BaseScrollArea.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5 opacity-0 transition-opacity duration-(--duration-menu) data-[hovering]:opacity-100 data-[scrolling]:opacity-100 data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2.5",
        className,
      )}
      {...props}
    >
      <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-control" />
    </BaseScrollArea.Scrollbar>
  );
}
