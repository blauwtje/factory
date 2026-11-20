import { AnimatePresence, motion, type Transition } from "motion/react";
import { Children, cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ItemProps = {
  "data-id": string;
  "data-checked"?: "true" | "false";
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

type Item = ReactElement<ItemProps>;

export type AnimatedBackgroundProps = {
  children: Item | Item[];
  defaultValue?: string;
  onValueChange?: (id: string | null) => void;
  className?: string;
  transition?: Transition;
  enableHover?: boolean;
};

export function AnimatedBackground({ children, defaultValue, onValueChange, className, transition = spring, enableHover = false }: AnimatedBackgroundProps) {
  const [activeId, setActiveId] = useState<string | null>(defaultValue ?? null);
  const layoutId = `background-${useId()}`;

  const select = (id: string | null) => {
    setActiveId(id);
    onValueChange?.(id);
  };

  return Children.map(children, (child) => {
    const id = child.props["data-id"];
    const handlers = enableHover
      ? { onMouseEnter: () => select(id), onMouseLeave: () => select(null) }
      : { onClick: () => select(id) };
    return cloneElement(
      child,
      { className: cn("relative inline-flex", child.props.className), "data-checked": activeId === id ? "true" : "false", ...handlers },
      <>
        <AnimatePresence initial={false}>
          {activeId === id && (
            <motion.div
              layoutId={layoutId}
              className={cn("absolute inset-0", className)}
              transition={transition}
              initial={{ opacity: defaultValue ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
          )}
        </AnimatePresence>
        <div className="z-10">{child.props.children}</div>
      </>,
    );
  });
}
