import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return <StickToBottom className={cn("relative flex-1 overflow-y-hidden", className)} initial="smooth" resize="smooth" role="log" aria-live="polite" aria-relevant="additions" {...props} />;
}

export function ConversationContent({ className, scrollClassName, ...props }: ComponentProps<typeof StickToBottom.Content>) {
  return <StickToBottom.Content className={cn("flex flex-col gap-6 p-4", className)} scrollClassName={cn("overflow-y-auto", scrollClassName)} {...props} />;
}

type EmptyStateProps = ComponentProps<"div"> & { title?: string; description?: string; icon?: ReactNode };

export function ConversationEmptyState({ className, title = "No messages yet", description, icon, children, ...props }: EmptyStateProps) {
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-4 p-8 text-center", className)} {...props}>
      {children ?? (
        <>
          {icon && <span className="flex size-12 items-center justify-center rounded-lg border border-control bg-raised text-faint">{icon}</span>}
          <div className="flex max-w-sm flex-col gap-1">
            <h3 className="text-balance text-title font-medium text-ink">{title}</h3>
            {description && <p className="text-pretty text-body text-muted">{description}</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function ConversationScrollButton({ className, ...props }: ComponentProps<typeof Button>) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: duration.press, ease: ease.out } }}
          transition={{ duration: duration.menu, ease: ease.out }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2"
        >
          <Button
            className={cn("h-8 gap-1.5 rounded-full bg-overlay px-3.5 text-label text-muted shadow-popover hover:text-ink", className)}
            onClick={() => void scrollToBottom()}
            variant="ghost"
            {...props}
          >
            <ArrowDown />
            Jump to latest
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
