import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

export const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap relative rounded-md font-medium text-muted ui-focus-inset transition-[background-color,color,box-shadow] duration-(--duration-press) after:absolute after:inset-x-0 after:-inset-y-2 hover:text-ink disabled:opacity-50 data-[pressed]:text-ink [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "data-[pressed]:bg-surface data-[pressed]:shadow-[0_0_0_1px_var(--edge)]",
        outline: "border border-field-edge data-[pressed]:border-accent/50 data-[pressed]:bg-accent-soft data-[pressed]:text-accent-text",
      },
      size: {
        default: "h-7 px-2.5 text-body",
        sm: "h-6 px-2 text-label",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ToggleVariants = VariantProps<typeof toggleVariants>;

const ToggleGroupContext = createContext<ToggleVariants>({});

export function ToggleGroup({ className, variant, size, children, ...props }: BaseToggleGroup.Props & ToggleVariants) {
  return (
    <BaseToggleGroup
      className={cn("flex w-fit items-center gap-0.5", variant !== "outline" && "rounded-lg bg-active p-0.5", className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
    </BaseToggleGroup>
  );
}

export function ToggleGroupItem({ className, variant, size, ...props }: Toggle.Props & ToggleVariants) {
  const group = useContext(ToggleGroupContext);
  return <Toggle className={cn(toggleVariants({ variant: group.variant ?? variant, size: group.size ?? size }), className)} {...props} />;
}
