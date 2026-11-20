import { AnimatePresence, motion, type MotionProps, type Transition, type Variant } from "motion/react";
import type { ReactNode } from "react";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

const defaultVariants = {
  enter: { opacity: 0, y: 6, filter: "blur(2px)" },
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(2px)" },
};

export type TransitionPanelProps = {
  children: ReactNode[];
  activeIndex: number;
  className?: string;
  transition?: Transition;
  variants?: { enter: Variant; center: Variant; exit: Variant };
} & MotionProps;

export function TransitionPanel({
  children,
  activeIndex,
  className,
  transition = { duration: duration.panel, ease: ease.out },
  variants = defaultVariants,
  ...motionProps
}: TransitionPanelProps) {
  return (
    <div className={cn("relative", className)}>
      <AnimatePresence initial={false} mode="popLayout" custom={motionProps.custom}>
        <motion.div key={activeIndex} variants={variants} transition={transition} initial="enter" animate="center" exit="exit" {...motionProps}>
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
