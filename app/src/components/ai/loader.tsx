import { cn } from "@/lib/utils";

export type LoaderVariant = "circular" | "dots" | "typing" | "pulse-dot";
export type LoaderSize = "xs" | "sm" | "md" | "lg";

const RING: Record<LoaderSize, string> = { xs: "size-3 border-[1.5px]", sm: "size-4 border-2", md: "size-5 border-2", lg: "size-6 border-2" };
const DOT: Record<LoaderSize, string> = { xs: "size-1", sm: "size-1.5", md: "size-2", lg: "size-2.5" };
const ROW: Record<LoaderSize, string> = { xs: "h-3", sm: "h-4", md: "h-5", lg: "h-6" };

function Dots({ size, animation, step }: { size: LoaderSize; animation: string; step: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1", ROW[size])}>
      {[0, 1, 2].map((index) => (
        <span key={index} className={cn("rounded-full bg-current", DOT[size], animation)} style={{ animationDelay: `${index * step}ms` }} />
      ))}
    </span>
  );
}

const VARIANTS: Record<LoaderVariant, (size: LoaderSize) => React.ReactNode> = {
  circular: (size) => <span className={cn("inline-block animate-spin rounded-full border-current border-t-transparent", RING[size])} />,
  dots: (size) => <Dots size={size} animation="animate-[loader-bounce_1.4s_ease-in-out_infinite]" step={160} />,
  typing: (size) => <Dots size={size} animation="animate-[loader-typing_1s_ease-in-out_infinite]" step={200} />,
  "pulse-dot": (size) => <span className={cn("inline-block animate-pulse rounded-full bg-current", DOT[size])} />,
};

export function Loader({ variant = "circular", size = "md", className, label = "Loading" }: { variant?: LoaderVariant; size?: LoaderSize; className?: string; label?: string }) {
  return (
    <span role="status" data-loader className={cn("inline-flex items-center text-current", className)}>
      {VARIANTS[variant](size)}
      <span className="sr-only">{label}</span>
    </span>
  );
}
