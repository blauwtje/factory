import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: BaseTabs.Root.Props) {
  return <BaseTabs.Root className={cn("flex flex-col gap-2 data-[orientation=vertical]:flex-row", className)} {...props} />;
}

const tabsListVariants = cva("group/tabs-list relative inline-flex w-fit items-center text-muted", {
  variants: {
    variant: {
      default: "h-8 gap-0.5 rounded-lg bg-active p-0.5",
      line: "h-9 gap-4 border-b border-edge",
      rail: "h-auto w-full flex-col items-stretch gap-0.5",
    },
  },
  defaultVariants: { variant: "default" },
});

export function TabsList({ className, variant = "default", children, ...props }: BaseTabs.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <BaseTabs.List data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props}>
      {children}
      <BaseTabs.Indicator
        className={cn(
          "absolute transition-[left,width] duration-(--duration-panel) ease-out",
          variant === "rail" ? "left-0 top-(--active-tab-top) h-(--active-tab-height) w-0.5 rounded-full bg-transparent transition-[top,height]!" : variant === "line" ? "left-(--active-tab-left) w-(--active-tab-width) bottom-[-1px] h-px bg-ink" : "left-(--active-tab-left) w-(--active-tab-width) top-0.5 h-(--active-tab-height) rounded-md bg-surface shadow-[0_0_0_1px_var(--edge)]",
        )}
      />
    </BaseTabs.List>
  );
}

export function TabsTrigger({ className, ...props }: BaseTabs.Tab.Props) {
  return (
    <BaseTabs.Tab
      className={cn(
        "relative z-10 inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-body font-medium ui-focus-inset transition-colors duration-(--duration-press) hover:text-ink disabled:opacity-50 data-[active]:text-ink group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=line]/tabs-list:px-0 group-data-[variant=rail]/tabs-list:h-9 group-data-[variant=rail]/tabs-list:justify-start group-data-[variant=rail]/tabs-list:rounded-md group-data-[variant=rail]/tabs-list:px-3 group-data-[variant=rail]/tabs-list:hover:bg-active group-data-[variant=rail]/tabs-list:data-[active]:bg-active group-data-[variant=rail]/tabs-list:active:scale-(--press-scale) [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: BaseTabs.Panel.Props) {
  return <BaseTabs.Panel className={cn("flex-1 outline-none", className)} {...props} />;
}
