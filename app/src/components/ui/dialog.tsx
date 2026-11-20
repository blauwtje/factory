import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const dialogPopup = "ui-dialog fixed left-1/2 top-1/2 max-h-[calc(100dvh-3rem)] w-full max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-overlay p-6 text-ink shadow-dialog outline-none";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;

export function DialogContent({ className, children, instant, ...props }: ComponentProps<typeof BaseDialog.Popup> & { instant?: boolean }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop data-instant={instant || undefined} className="ui-backdrop fixed inset-0 bg-ink/15 dark:bg-black/50" />
      <BaseDialog.Popup
        className={cn(dialogPopup, className)}
        data-instant={instant || undefined}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn("mb-5 text-title font-medium text-ink", className)} {...props} />;
}
