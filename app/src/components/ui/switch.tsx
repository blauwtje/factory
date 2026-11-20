import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const TRAVEL = 16;
const THUMB_SPRING = { type: "spring", duration: 0.3, bounce: 0 } as const;

export function Switch({ className, ...props }: BaseSwitch.Root.Props) {
  return (
    <BaseSwitch.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-field-edge p-0.5 ui-focus transition-colors duration-(--duration-press) after:absolute after:-inset-1 data-[checked]:bg-accent data-[checked]:hover:bg-accent-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        render={(thumbProps, state) => (
          <motion.span
            {...(thumbProps as object)}
            initial={false}
            animate={{ x: state.checked ? TRAVEL : 0 }}
            transition={THUMB_SPRING}
            className={cn("block size-4 rounded-full shadow-card", state.checked ? "bg-accent-ink" : "bg-surface")}
          />
        )}
      />
    </BaseSwitch.Root>
  );
}
