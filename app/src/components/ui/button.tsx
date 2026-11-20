import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ui-focus transition-[background-color,color,border-color,box-shadow,transform,translate,scale] duration-(--duration-press) ease-out active:not-aria-[haspopup]:scale-(--press-scale) disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink hover:bg-accent-hover",
        secondary: "bg-active text-ink hover:bg-control/70",
        outline: "border border-edge bg-surface text-ink hover:border-control hover:bg-raised aria-expanded:bg-raised",
        ghost: "text-muted hover:bg-active hover:text-ink aria-expanded:bg-active aria-expanded:text-ink",
        destructive: "bg-failed-soft text-failed-ink hover:bg-failed/20",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 text-body",
        xs: "h-6 gap-1 rounded-md px-2 text-label [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-label [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 rounded-lg px-4 text-body",
        icon: "size-8",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <BaseButton data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
