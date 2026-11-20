import { useRender } from "@base-ui/react/use-render";
import { mergeProps } from "@base-ui/react/merge-props";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 text-label font-medium [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent-soft text-accent-text",
        secondary: "bg-active text-ink",
        outline: "border-edge text-muted",
        running: "bg-running-soft text-running-ink",
        waiting: "bg-waiting-soft text-muted",
        done: "bg-done-soft text-done-ink",
        failed: "bg-failed-soft text-failed-ink",
        approval: "bg-approval-soft text-approval-ink",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type BadgeProps = useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, render, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props),
  });
}
