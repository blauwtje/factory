import { useReducedMotion } from "motion/react";
import { memo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type TextShimmerProps = {
  children: string;
  as?: "span" | "p" | "div";
  className?: string;
  duration?: number;
  spread?: number;
};

function TextShimmerComponent({ children, as: Component = "span", className, duration, spread = 2 }: TextShimmerProps) {
  const still = useReducedMotion();
  if (still) return <Component className={cn("text-muted", className)}>{children}</Component>;
  return (
    <Component
      className={cn(
        "relative inline-block animate-[text-shimmer_var(--duration-loop)_linear_infinite] bg-size-[250%_100%,auto] bg-clip-text [background-repeat:no-repeat,padding-box]",
        "[--shimmer-base:var(--muted)] [--shimmer-glint:var(--ink)]",
        className,
      )}
      style={{
        "--spread": `${children.length * spread}px`,
        WebkitTextFillColor: "transparent",
        animationDuration: duration === undefined ? undefined : `${duration}s`,
        backgroundImage:
          "linear-gradient(90deg, #0000 calc(50% - var(--spread)), var(--shimmer-glint), #0000 calc(50% + var(--spread))), linear-gradient(var(--shimmer-base), var(--shimmer-base))",
      } as CSSProperties}
    >
      {children}
    </Component>
  );
}

export const TextShimmer = memo(TextShimmerComponent);
